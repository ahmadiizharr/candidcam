"""Image handling: every upload is decoded and re-encoded, so what we store is a plain
JPEG/WebP without metadata (no GPS from a guest's phone), whatever the client sent."""

import io
import re
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from .db import DB

Image.MAX_IMAGE_PIXELS = 60_000_000
ALLOWED = {"JPEG", "PNG", "WEBP"}
PHOTO_MAX = 2400
THUMB_MAX = 720
COVER_MAX = 1600


def read_upload(upload: UploadFile, max_mb: int) -> bytes:
    data = upload.file.read(max_mb * 1024 * 1024 + 1)
    if len(data) > max_mb * 1024 * 1024:
        raise HTTPException(413, f"Ukuran foto maksimal {max_mb} MB")
    if not data:
        raise HTTPException(422, "File foto kosong")
    return data


def _open(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        if img.format not in ALLOWED:
            raise HTTPException(415, "Format foto harus JPG, PNG, atau WebP")
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(415, "File bukan foto yang valid")
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        bg = Image.new("RGB", img.size, (255, 255, 255))
        rgba = img.convert("RGBA")
        bg.paste(rgba, mask=rgba.getchannel("A"))
        img = bg
    return img


def _fit(img: Image.Image, longest: int) -> Image.Image:
    if max(img.size) <= longest:
        return img
    img = img.copy()
    img.thumbnail((longest, longest), Image.LANCZOS)
    return img


def save_cover(data: bytes, path: Path) -> None:
    img = _fit(_open(data), COVER_MAX)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=84, method=4)


def save_photo(data: bytes, folder: Path, photo_id: str) -> tuple[int, int]:
    img = _fit(_open(data), PHOTO_MAX)
    folder.mkdir(parents=True, exist_ok=True)
    img.save(folder / f"{photo_id}.jpg", "JPEG", quality=90, optimize=True, progressive=True)
    _fit(img, THUMB_MAX).save(folder / f"{photo_id}_t.webp", "WEBP", quality=80, method=4)
    return img.size


def remove_photo_files(folder: Path, photo_id: str) -> None:
    for name in (f"{photo_id}.jpg", f"{photo_id}_t.webp"):
        (folder / name).unlink(missing_ok=True)


SORTS = {
    "newest": "p.created_at DESC, p.rowid DESC",
    "oldest": "p.created_at ASC, p.rowid ASC",
    "most_liked": "p.likes_count DESC, p.created_at DESC",
    "least_liked": "p.likes_count ASC, p.created_at DESC",
}


def list_photos(
    db: DB,
    event_id: str,
    *,
    sort: str = "newest",
    guest_id: str | None = None,
    viewer_id: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    order = SORTS.get(sort, SORTS["newest"])
    sql = """SELECT p.*, g.name AS guest_name,
                    EXISTS(SELECT 1 FROM likes l WHERE l.photo_id = p.id AND l.guest_id = ?) AS liked
             FROM photos p JOIN guests g ON g.id = p.guest_id WHERE p.event_id = ?"""
    args: list = [viewer_id or "", event_id]
    if guest_id:
        sql += " AND p.guest_id = ?"
        args.append(guest_id)
    sql += f" ORDER BY {order}"
    if limit:
        sql += " LIMIT ?"
        args.append(limit)
    return [photo_view(row) for row in db.all(sql, *args)]


def photo_view(row) -> dict:
    base = f"/media/{row['event_id']}/{row['id']}"
    return {
        "id": row["id"],
        "guest_id": row["guest_id"],
        "guest_name": row["guest_name"],
        "url": f"{base}.jpg",
        "thumb_url": f"{base}_t.webp",
        "width": row["width"],
        "height": row["height"],
        "filter": row["filter"],
        "source": row["source"],
        "likes_count": row["likes_count"],
        "liked": bool(row["liked"]),
        "created_at": row["created_at"],
    }


def download_name(guest_name: str, index: int, used: set[str]) -> str:
    safe = re.sub(r"[^A-Za-z0-9]+", "-", guest_name).strip("-")[:30] or "tamu"
    name = f"{index:03d}-{safe}.jpg"
    used.add(name)
    return name
