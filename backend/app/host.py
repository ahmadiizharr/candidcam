"""Host API: the events a logged-in host owns, their cover, photos and guests."""

import os
import secrets
import shutil
import tempfile
import zipfile
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from . import events, media
from .auth import require_user
from .db import DB, iso, now
from .events import EventIn


def create_router() -> APIRouter:
    r = APIRouter(prefix="/api/events")
    User = Annotated[object, Depends(require_user)]

    def ctx(request: Request):
        s = request.app.state
        return s.db, s.catalog, s.settings

    def owned(request: Request, user, event_id: str):
        row = request.app.state.db.one("SELECT * FROM events WHERE id = ? AND user_id = ?", event_id, user["id"])
        if row is None:
            raise HTTPException(404, "Acara tidak ditemukan")
        return row

    def stats(db: DB, event_id: str) -> dict:
        row = db.one(
            """SELECT (SELECT COUNT(*) FROM guests WHERE event_id = ?) AS guests_count,
                      (SELECT COUNT(*) FROM photos WHERE event_id = ?) AS photos_count,
                      (SELECT COALESCE(SUM(likes_count), 0) FROM photos WHERE event_id = ?) AS likes_count""",
            event_id, event_id, event_id,
        )
        return dict(row)

    def view(request: Request, row) -> dict:
        db, _, settings = ctx(request)
        return events.host_view(row, settings.public_base_url, settings.retention_days, stats(db, row["id"]))

    @r.get("")
    def list_events(request: Request, user: User):
        db, _, _ = ctx(request)
        rows = db.all("SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC", user["id"])
        return {"events": [view(request, row) for row in rows]}

    @r.get("/check-slug")
    def check_slug(request: Request, user: User, slug: str = "", exclude: str | None = None):
        db, _, _ = ctx(request)
        problem = events.slug_problem(slug)
        if problem is None:
            taken = db.one("SELECT id FROM events WHERE slug = ?", slug)
            if taken and taken["id"] != exclude:
                problem = "taken"
        return {"available": problem is None, "reason": problem}

    @r.get("/suggest-slug")
    def suggest_slug(user: User, name: str = ""):
        return {"slug": events.suggest_slug(name)}

    @r.post("")
    def create(body: EventIn, request: Request, user: User):
        db, catalog, _ = ctx(request)
        data = events.clean(body, catalog, {**events.defaults(catalog), "name": None, "slug": None})
        slug = (data["slug"] or events.suggest_slug(data["name"])).lower()
        if events.slug_problem(slug):
            raise HTTPException(422, "Link acara tidak valid: 3–40 huruf kecil, angka, atau tanda hubung")
        data["slug"] = slug
        event_id = secrets.token_hex(16)
        cols = events.to_columns(data)
        cols.update(id=event_id, user_id=user["id"], display_passcode=events.new_passcode(), created_at=iso(now()), updated_at=iso(now()))
        with db.tx() as c:
            if c.execute("SELECT 1 FROM events WHERE slug = ?", (slug,)).fetchone():
                raise HTTPException(409, "Link ini sudah dipakai acara lain")
            c.execute(f"INSERT INTO events ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", tuple(cols.values()))
        return view(request, db.one("SELECT * FROM events WHERE id = ?", event_id))

    @r.get("/{event_id}")
    def get_event(event_id: str, request: Request, user: User):
        return view(request, owned(request, user, event_id))

    @r.patch("/{event_id}")
    def update(event_id: str, body: EventIn, request: Request, user: User):
        db, catalog, _ = ctx(request)
        row = owned(request, user, event_id)
        data = events.clean(body, catalog, {**events.from_row(row)})
        data["slug"] = data["slug"].lower()
        if data["slug"] != row["slug"] and events.slug_problem(data["slug"]):
            raise HTTPException(422, "Link acara tidak valid: 3–40 huruf kecil, angka, atau tanda hubung")
        cols = events.to_columns(data)
        cols["updated_at"] = iso(now())
        with db.tx() as c:
            if c.execute("SELECT 1 FROM events WHERE slug = ? AND id != ?", (data["slug"], event_id)).fetchone():
                raise HTTPException(409, "Link ini sudah dipakai acara lain")
            c.execute(f"UPDATE events SET {', '.join(f'{k} = ?' for k in cols)} WHERE id = ?", (*cols.values(), event_id))
        return view(request, db.one("SELECT * FROM events WHERE id = ?", event_id))

    @r.delete("/{event_id}")
    def delete(event_id: str, request: Request, user: User):
        db, _, settings = ctx(request)
        owned(request, user, event_id)
        db.run("DELETE FROM events WHERE id = ?", event_id)
        shutil.rmtree(settings.media_dir / event_id, ignore_errors=True)
        return {"ok": True}

    @r.post("/{event_id}/cover")
    def upload_cover(event_id: str, request: Request, user: User, photo: UploadFile = File(...)):
        db, _, settings = ctx(request)
        row = owned(request, user, event_id)
        data = media.read_upload(photo, settings.max_upload_mb)
        name = f"cover-{secrets.token_hex(4)}.webp"
        media.save_cover(data, settings.media_dir / event_id / name)
        if row["cover"]:
            (settings.media_dir / event_id / row["cover"]).unlink(missing_ok=True)
        db.run("UPDATE events SET cover = ?, updated_at = ? WHERE id = ?", name, iso(now()), event_id)
        return view(request, db.one("SELECT * FROM events WHERE id = ?", event_id))

    @r.delete("/{event_id}/cover")
    def delete_cover(event_id: str, request: Request, user: User):
        db, _, settings = ctx(request)
        row = owned(request, user, event_id)
        if row["cover"]:
            (settings.media_dir / event_id / row["cover"]).unlink(missing_ok=True)
        db.run("UPDATE events SET cover = NULL, updated_at = ? WHERE id = ?", iso(now()), event_id)
        return view(request, db.one("SELECT * FROM events WHERE id = ?", event_id))

    @r.post("/{event_id}/display-passcode")
    def regenerate_passcode(event_id: str, request: Request, user: User):
        db, _, _ = ctx(request)
        owned(request, user, event_id)
        db.run("UPDATE events SET display_passcode = ? WHERE id = ?", events.new_passcode(), event_id)
        return view(request, db.one("SELECT * FROM events WHERE id = ?", event_id))

    @r.get("/{event_id}/guests")
    def list_guests(event_id: str, request: Request, user: User):
        db, _, _ = ctx(request)
        owned(request, user, event_id)
        rows = db.all(
            """SELECT g.id, g.name, g.created_at, COUNT(p.id) AS photos_count
               FROM guests g LEFT JOIN photos p ON p.guest_id = g.id
               WHERE g.event_id = ? GROUP BY g.id ORDER BY g.created_at, g.rowid""",
            event_id,
        )
        return {"guests": [dict(x) for x in rows]}

    @r.get("/{event_id}/photos")
    def list_photos(event_id: str, request: Request, user: User, sort: str = "newest", guest: str | None = None):
        db, _, _ = ctx(request)
        owned(request, user, event_id)
        return {"photos": media.list_photos(db, event_id, sort=sort, guest_id=guest)}

    @r.delete("/{event_id}/photos/{photo_id}")
    def delete_photo(event_id: str, photo_id: str, request: Request, user: User):
        db, _, settings = ctx(request)
        owned(request, user, event_id)
        if not db.run("DELETE FROM photos WHERE id = ? AND event_id = ?", photo_id, event_id):
            raise HTTPException(404, "Foto tidak ditemukan")
        media.remove_photo_files(settings.media_dir / event_id, photo_id)
        return {"ok": True}

    @r.get("/{event_id}/photos.zip")
    def download_zip(event_id: str, request: Request, user: User, background: BackgroundTasks):
        db, _, settings = ctx(request)
        row = owned(request, user, event_id)
        photos = media.list_photos(db, event_id, sort="oldest")
        if not photos:
            raise HTTPException(404, "Belum ada foto")
        tmp = tempfile.NamedTemporaryFile(prefix="zip-", suffix=".zip", dir=settings.data_dir, delete=False)
        used: set[str] = set()
        # JPEG sudah terkompresi, jadi ZIP_STORED: cepat dan ukurannya hampir sama.
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
            for i, p in enumerate(photos, 1):
                name = media.download_name(p["guest_name"], i, used)
                z.write(settings.media_dir / event_id / f"{p['id']}.jpg", name)
        tmp.close()
        background.add_task(os.unlink, tmp.name)
        return FileResponse(tmp.name, media_type="application/zip", filename=f"{row['slug']}-foto.zip")

    return r
