"""Event settings: validation against the catalog, and the shapes the host and guests see."""

import json
import re
import secrets
import unicodedata
from datetime import timedelta

from fastapi import HTTPException
from pydantic import BaseModel, Field

from .db import iso, now, parse_iso

SLUG = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$")
# Paths the app itself uses at the root, so a guest link can never shadow them.
RESERVED = {
    "app", "api", "assets", "media", "display", "login", "register", "logout", "admin", "dashboard",
    "static", "public", "fonts", "luts", "favicon", "robots", "sitemap", "health", "about", "help",
    "pricing", "terms", "privacy", "camera", "new", "www", "mail", "candid", "cam",
}
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
BOOLS = ("allow_gallery_upload", "guest_can_see_others", "enable_likes", "wm_enabled", "wm_show_date", "allow_clean_download")


class EventIn(BaseModel):
    name: str | None = Field(default=None, max_length=40)
    couple_names: str | None = Field(default=None, max_length=60)
    slug: str | None = Field(default=None, max_length=40)
    language: str | None = None
    theme: str | None = None
    aspect_ratio: str | None = None
    filters: list[str] | None = None
    frame_style: str | None = None
    frame_paper: str | None = None
    frame_caption: str | None = Field(default=None, max_length=40)
    frame_date: str | None = None
    frame_hashtag: str | None = Field(default=None, max_length=40)
    frame_font: str | None = None
    frame_text_color: str | None = None
    frame_date_format: str | None = None
    participant_limit: int | None = None
    max_photos_per_guest: int | None = None
    allow_gallery_upload: bool | None = None
    guest_can_see_others: bool | None = None
    enable_likes: bool | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    accent_color: str | None = None
    display_layout: str | None = None
    display_palette: str | None = None
    wm_enabled: bool | None = None
    wm_mode: str | None = None
    wm_text: str | None = Field(default=None, max_length=60)
    wm_show_date: bool | None = None
    wm_font: str | None = None
    wm_color: str | None = None
    wm_opacity: int | None = None
    wm_size: str | None = None
    wm_pos_portrait: str | None = None
    wm_pos_landscape: str | None = None
    allow_clean_download: bool | None = None


def defaults(catalog: dict) -> dict:
    return {
        "couple_names": None,
        "language": "id",
        "theme": "dark_elegant",
        "aspect_ratio": "3:4",
        "filters": [f["id"] for f in catalog["filters"]],
        "frame_style": "none",
        "frame_paper": "white",
        "frame_caption": None,
        "frame_date": None,
        "frame_hashtag": None,
        "frame_font": "playfair",
        "frame_text_color": "#1d1d1d",
        "frame_date_format": "dd/mm/yyyy",
        "participant_limit": catalog["free_participants"],
        "max_photos_per_guest": 10,
        "allow_gallery_upload": False,
        "guest_can_see_others": True,
        "enable_likes": True,
        "starts_at": None,
        "ends_at": None,
        "accent_color": None,
        "display_layout": "filmstrip",
        "display_palette": "midnight",
        "wm_enabled": False,
        "wm_mode": "text",
        "wm_text": None,
        "wm_show_date": True,
        "wm_font": "playfair",
        "wm_color": "#ffffff",
        "wm_opacity": 85,
        "wm_size": "md",
        "wm_pos_portrait": "bottom-right",
        "wm_pos_landscape": "bottom-right",
        "allow_clean_download": True,
    }


def slug_problem(slug: str) -> str | None:
    if not SLUG.match(slug) or "--" in slug:
        return "invalid"
    if slug in RESERVED:
        return "reserved"
    return None


def suggest_slug(name: str) -> str:
    base = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:30].strip("-") or "acara"
    suffix = "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz") for _ in range(3))
    return f"{base}-{suffix}"


def _bad(msg: str):
    raise HTTPException(422, msg)


def clean(body: EventIn, catalog: dict, current: dict) -> dict:
    """Merge the fields the client sent onto `current` and validate the result as a whole."""
    out = dict(current)
    for key in body.model_fields_set:
        value = getattr(body, key)
        if isinstance(value, str):
            value = value.strip()
            if value == "" and key not in ("name", "slug"):
                value = None
        out[key] = value

    ids = lambda k: {x["id"] for x in catalog[k]}  # noqa: E731
    if not out.get("name"):
        _bad("Nama acara wajib diisi")
    for key, cat in (
        ("language", "languages"),
        ("theme", "themes"),
        ("aspect_ratio", "aspect_ratios"),
        ("frame_style", "frame_styles"),
        ("frame_paper", "frame_papers"),
        ("frame_font", "frame_fonts"),
        ("frame_date_format", "date_formats"),
    ):
        if out[key] not in ids(cat):
            _bad(f"Pilihan {key} tidak dikenal")
    for key, cat in (("display_layout", "display_layouts"), ("display_palette", "display_palettes"), ("wm_font", "frame_fonts")):
        if out[key] not in ids(cat):
            _bad(f"Pilihan {key} tidak dikenal")
    wm = catalog["watermark"]
    if out["wm_mode"] not in {m["id"] for m in wm["modes"]} or out["wm_size"] not in {z["id"] for z in wm["sizes"]}:
        _bad("Pengaturan watermark tidak dikenal")
    if out["wm_pos_portrait"] not in wm["positions"] or out["wm_pos_landscape"] not in wm["positions"]:
        _bad("Posisi watermark tidak dikenal")
    if not isinstance(out["wm_opacity"], int) or not 10 <= out["wm_opacity"] <= 100:
        _bad("Transparansi watermark harus 10–100")
    for key in ("accent_color", "wm_color"):
        if out[key] is not None:
            if not HEX.match(out[key]):
                _bad("Warna harus berformat #RRGGBB")
            out[key] = out[key].lower()
    if out["wm_color"] is None:
        _bad("Warna watermark wajib diisi")
    filters = out["filters"] or []
    if not filters:
        _bad("Pilih minimal 1 filter")
    if not set(filters) <= ids("filters"):
        _bad("Ada filter yang tidak dikenal")
    out["filters"] = [f["id"] for f in catalog["filters"] if f["id"] in set(filters)]
    if out["participant_limit"] not in catalog["participant_limits"]:
        _bad("Kuota peserta tidak valid")
    if out["max_photos_per_guest"] not in catalog["photos_per_guest"]:
        _bad("Jumlah foto per tamu tidak valid")
    if out["frame_text_color"] is None or not HEX.match(out["frame_text_color"]):
        _bad("Warna teks harus berformat #RRGGBB")
    if out["frame_date"] is not None and not DATE.match(out["frame_date"]):
        _bad("Tanggal bingkai harus berformat YYYY-MM-DD")
    for key in ("starts_at", "ends_at"):
        if out[key] is not None:
            try:
                dt = parse_iso(out[key])
            except ValueError:
                _bad("Format jadwal tidak valid")
            if dt.tzinfo is None:
                _bad("Jadwal harus menyertakan zona waktu")
            out[key] = iso(dt)
    if out["starts_at"] and out["ends_at"] and out["ends_at"] <= out["starts_at"]:
        _bad("Waktu selesai harus setelah waktu mulai")
    return out


def to_columns(data: dict) -> dict:
    cols = {k: v for k, v in data.items() if k in EventIn.model_fields}
    cols["filters"] = json.dumps(data["filters"])
    for key in BOOLS:
        cols[key] = int(bool(data[key]))
    return cols


def from_row(row) -> dict:
    d = {k: row[k] for k in EventIn.model_fields}
    d["filters"] = json.loads(row["filters"])
    for key in BOOLS:
        d[key] = bool(d[key])
    return d


def status(row) -> str:
    if row["photos_deleted_at"]:
        return "archived"
    t = iso(now())
    if row["starts_at"] and t < row["starts_at"]:
        return "not_started"
    if row["ends_at"] and t > row["ends_at"]:
        return "ended"
    return "open"


def cover_url(row) -> str | None:
    return f"/media/{row['id']}/{row['cover']}" if row["cover"] else None


def photos_expire_at(row, retention_days: int) -> str | None:
    first = parse_iso(row["first_photo_at"])
    return iso(first + timedelta(days=retention_days)) if first else None


def host_view(row, base_url: str, retention_days: int, stats: dict) -> dict:
    return {
        "id": row["id"],
        **from_row(row),
        "public_url": f"{base_url}/{row['slug']}",
        "display_url": f"{base_url}/display/{row['id']}",
        "cover_url": cover_url(row),
        "display_passcode": row["display_passcode"],
        "wm_image_url": f"/media/{row['id']}/{row['wm_image']}" if row["wm_image"] else None,
        "status": status(row),
        "photos_expire_at": photos_expire_at(row, retention_days),
        "photos_deleted_at": row["photos_deleted_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        **stats,
    }


def guest_view(row, base_url: str, guests_count: int) -> dict:
    """What anyone holding the link may see: no passcode, no owner details."""
    d = from_row(row)
    return {
        "id": row["id"],
        "slug": row["slug"],
        "public_url": f"{base_url}/{row['slug']}",
        "cover_url": cover_url(row),
        "status": status(row),
        "guests_count": guests_count,
        "quota_full": d["participant_limit"] is not None and guests_count >= d["participant_limit"],
        "created_at": row["created_at"],
        **{k: d[k] for k in d if k != "slug"},
    }


def new_passcode() -> str:
    return f"{secrets.randbelow(10**6):06d}"
