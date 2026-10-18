"""Guest API, reached through the event link. A guest is a name plus a random token kept in
the browser; there are no accounts on this side."""

import io
import secrets
from typing import Annotated

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
import segno
from pydantic import BaseModel, Field

from . import events, media
from .db import iso, now
from .security import new_token, token_digest


class JoinIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


def create_router() -> APIRouter:
    r = APIRouter(prefix="/api/g/{slug}")
    Token = Annotated[str | None, Header(alias="X-Guest-Token")]

    def event_by_slug(request: Request, slug: str):
        row = request.app.state.db.one("SELECT * FROM events WHERE slug = ?", slug.lower())
        if row is None:
            raise HTTPException(404, "Acara tidak ditemukan")
        return row

    def guest_of(request: Request, event, token: str | None):
        if not token:
            raise HTTPException(401, "Masukkan namamu dulu")
        guest = request.app.state.db.one(
            "SELECT * FROM guests WHERE token_hash = ? AND event_id = ?", token_digest(token), event["id"]
        )
        if guest is None:
            raise HTTPException(401, "Sesi tamu tidak ditemukan, silakan masuk lagi")
        return guest

    def guests_count(request: Request, event_id: str) -> int:
        return request.app.state.db.one("SELECT COUNT(*) AS n FROM guests WHERE event_id = ?", event_id)["n"]

    def guest_view(request: Request, event, guest) -> dict:
        taken = request.app.state.db.one("SELECT COUNT(*) AS n FROM photos WHERE guest_id = ?", guest["id"])["n"]
        return {
            "id": guest["id"],
            "name": guest["name"],
            "photos_taken": taken,
            "photos_left": max(0, event["max_photos_per_guest"] - taken),
        }

    @r.get("")
    def lookup(slug: str, request: Request):
        event = event_by_slug(request, slug)
        base = request.app.state.settings.public_base_url
        return {"event": events.guest_view(event, base, guests_count(request, event["id"]))}

    @r.get("/qr.svg")
    def qr(slug: str, request: Request, dark: str = "000000", light: str = "ffffff"):
        event = event_by_slug(request, slug)
        url = f"{request.app.state.settings.public_base_url}/{event['slug']}"
        colors = [c if len(c) == 6 and all(x in "0123456789abcdefABCDEF" for x in c) else d for c, d in ((dark, "000000"), (light, "ffffff"))]
        buf = io.BytesIO()
        # Level Q so the logo the live display lays over the centre never breaks scanning.
        segno.make(url, error="q").save(buf, kind="svg", scale=8, border=2, dark=f"#{colors[0]}", light=f"#{colors[1]}", xmldecl=False, svgns=True)
        return Response(buf.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=3600"})

    @r.get("/qr.png")
    def qr_png(slug: str, request: Request):
        event = event_by_slug(request, slug)
        url = f"{request.app.state.settings.public_base_url}/{event['slug']}"
        buf = io.BytesIO()
        segno.make(url, error="m").save(buf, kind="png", scale=24, border=3)
        return Response(buf.getvalue(), media_type="image/png", headers={"Content-Disposition": f'attachment; filename="qr-{event["slug"]}.png"'})

    @r.post("/join")
    def join(slug: str, body: JoinIn, request: Request):
        db = request.app.state.db
        event = event_by_slug(request, slug)
        name = " ".join(body.name.split())
        if not name:
            raise HTTPException(422, "Nama wajib diisi")
        if event["photos_deleted_at"]:
            raise HTTPException(410, "Album acara ini sudah diarsipkan")
        token = new_token()
        guest_id = secrets.token_hex(8)
        with db.tx() as c:
            limit = event["participant_limit"]
            joined = c.execute("SELECT COUNT(*) FROM guests WHERE event_id = ?", (event["id"],)).fetchone()[0]
            if limit is not None and joined >= limit:
                raise HTTPException(409, "Kuota peserta sudah habis")
            c.execute(
                "INSERT INTO guests (id, event_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (guest_id, event["id"], name, token_digest(token), iso(now())),
            )
        guest = db.one("SELECT * FROM guests WHERE id = ?", guest_id)
        return {"token": token, "guest": guest_view(request, event, guest)}

    @r.get("/session")
    def session(slug: str, request: Request, token: Token = None):
        event = event_by_slug(request, slug)
        return {"guest": guest_view(request, event, guest_of(request, event, token))}

    @r.post("/photos")
    def upload(
        slug: str,
        request: Request,
        token: Token = None,
        photo: UploadFile = File(...),
        filter: str = Form("none"),
        source: str = Form("camera"),
    ):
        db, settings = request.app.state.db, request.app.state.settings
        event = event_by_slug(request, slug)
        guest = guest_of(request, event, token)
        state = events.status(event)
        if state == "not_started":
            raise HTTPException(403, "Acara belum dimulai")
        if state in ("ended", "archived"):
            raise HTTPException(403, "Acara telah berakhir")
        if source not in ("camera", "gallery"):
            raise HTTPException(422, "Sumber foto tidak dikenal")
        if source == "gallery" and not event["allow_gallery_upload"]:
            raise HTTPException(403, "Upload dari galeri tidak diizinkan di acara ini")
        # Gallery picks are uploaded as-is, so "none" is always fine there.
        allowed = events.from_row(event)["filters"] + (["none"] if source == "gallery" else [])
        if filter not in allowed:
            raise HTTPException(422, "Filter tidak tersedia di acara ini")

        data = media.read_upload(photo, settings.max_upload_mb)
        photo_id = secrets.token_urlsafe(12)
        folder = settings.media_dir / event["id"]
        # Cheap check first so a guest with an empty roll doesn't make us decode the image.
        if guest_view(request, event, guest)["photos_left"] <= 0:
            raise HTTPException(409, "Roll film kamu sudah habis")
        width, height = media.save_photo(data, folder, photo_id)
        try:
            with db.tx() as c:
                taken = c.execute("SELECT COUNT(*) FROM photos WHERE guest_id = ?", (guest["id"],)).fetchone()[0]
                if taken >= event["max_photos_per_guest"]:
                    raise HTTPException(409, "Roll film kamu sudah habis")
                stamp = iso(now())
                c.execute(
                    """INSERT INTO photos (id, event_id, guest_id, filter, source, width, height, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (photo_id, event["id"], guest["id"], filter, source, width, height, stamp),
                )
                c.execute("UPDATE events SET first_photo_at = COALESCE(first_photo_at, ?) WHERE id = ?", (stamp, event["id"]))
        except BaseException:
            media.remove_photo_files(folder, photo_id)
            raise
        rows = media.list_photos(db, event["id"], guest_id=guest["id"], viewer_id=guest["id"], limit=1)
        return {"photo": rows[0], "guest": guest_view(request, event, guest)}

    @r.get("/photos")
    def gallery(slug: str, request: Request, token: Token = None, scope: str = "mine", sort: str = "newest"):
        event = event_by_slug(request, slug)
        guest = guest_of(request, event, token)
        if scope == "all":
            if not event["guest_can_see_others"]:
                raise HTTPException(403, "Host tidak membuka galeri bersama")
            photos = media.list_photos(request.app.state.db, event["id"], sort=sort, viewer_id=guest["id"])
        else:
            photos = media.list_photos(request.app.state.db, event["id"], sort=sort, guest_id=guest["id"], viewer_id=guest["id"])
        return {"photos": photos}

    @r.post("/photos/{photo_id}/like")
    def like(slug: str, photo_id: str, request: Request, token: Token = None):
        db = request.app.state.db
        event = event_by_slug(request, slug)
        guest = guest_of(request, event, token)
        if not event["enable_likes"]:
            raise HTTPException(403, "Fitur like tidak aktif")
        with db.tx() as c:
            photo = c.execute("SELECT guest_id FROM photos WHERE id = ? AND event_id = ?", (photo_id, event["id"])).fetchone()
            if photo is None:
                raise HTTPException(404, "Foto tidak ditemukan")
            if photo["guest_id"] != guest["id"] and not event["guest_can_see_others"]:
                raise HTTPException(403, "Host tidak membuka galeri bersama")
            if c.execute("DELETE FROM likes WHERE photo_id = ? AND guest_id = ?", (photo_id, guest["id"])).rowcount:
                liked = False
            else:
                c.execute("INSERT INTO likes (photo_id, guest_id) VALUES (?, ?)", (photo_id, guest["id"]))
                liked = True
            c.execute("UPDATE photos SET likes_count = (SELECT COUNT(*) FROM likes WHERE photo_id = ?) WHERE id = ?", (photo_id, photo_id))
            count = c.execute("SELECT likes_count FROM photos WHERE id = ?", (photo_id,)).fetchone()[0]
        return {"liked": liked, "likes_count": count}

    @r.get("/photos/{photo_id}/download")
    def download(slug: str, photo_id: str, request: Request):
        # Photo ids are unguessable; whoever has one may already load the image itself.
        event = event_by_slug(request, slug)
        row = request.app.state.db.one("SELECT id FROM photos WHERE id = ? AND event_id = ?", photo_id, event["id"])
        if row is None:
            raise HTTPException(404, "Foto tidak ditemukan")
        path = request.app.state.settings.media_dir / event["id"] / f"{photo_id}.jpg"
        return FileResponse(path, media_type="image/jpeg", filename=f"{event['slug']}-{photo_id[:6]}.jpg")

    return r
