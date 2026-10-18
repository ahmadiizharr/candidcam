"""Watermarks drawn on the server, so the clean upload is always kept and the host (or guests,
if allowed) can still download it. Watermarked copies are rendered on first request and
cached next to the original under a name that carries a hash of the settings: change the
settings and every URL changes with them."""

import hashlib
import json
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from .db import parse_iso

THUMB_MAX = 720
KEYS = ("wm_mode", "wm_text", "wm_show_date", "wm_font", "wm_color", "wm_opacity", "wm_size", "wm_pos_portrait", "wm_pos_landscape", "wm_image")


def _get(row, key):
    try:
        return row[key]
    except (KeyError, IndexError):
        return None


def event_date(row) -> datetime | None:
    """The day of the event: its schedule, else the date printed on the frame, else creation."""
    if _get(row, "starts_at"):
        return parse_iso(row["starts_at"])
    if _get(row, "frame_date"):
        return datetime.strptime(row["frame_date"], "%Y-%m-%d")
    if _get(row, "created_at"):
        return parse_iso(row["created_at"])
    return None


def date_text(row) -> str:
    d = event_date(row)
    if d is None:
        return ""
    if _get(row, "frame_date_format") == "mm/dd/yyyy":
        return d.strftime("%m.%d.%Y")
    return d.strftime("%d.%m.%Y")


def wm_hash(row) -> str | None:
    """Version of the watermark; None when the event has none."""
    if not _get(row, "wm_enabled"):
        return None
    payload = {k: _get(row, k) for k in KEYS}
    payload["date"] = date_text(row) if _get(row, "wm_show_date") else ""
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:10]


@lru_cache(maxsize=64)
def _font(path: str, size: int, wght: int | None):
    font = ImageFont.truetype(path, size)
    if wght:
        try:
            axes = font.get_variation_axes()
            font.set_variation_by_axes([wght if a["name"] in (b"Weight", "Weight") else a["default"] for a in axes])
        except OSError:
            pass
    return font


def _place(pos: str, box: tuple[int, int, int, int], size: tuple[int, int], margin: int) -> tuple[int, int]:
    x0, y0, w, h = box
    bw, bh = size
    vert, _, horiz = pos.partition("-") if pos != "center" else ("center", "", "center")
    if horiz == "left":
        x = x0 + margin
    elif horiz == "right":
        x = x0 + w - margin - bw
    else:
        x = x0 + (w - bw) // 2
    if vert == "top":
        y = y0 + margin
    elif vert == "bottom":
        y = y0 + h - margin - bh
    else:
        y = y0 + (h - bh) // 2
    return x, y


def _hex(color: str) -> tuple[int, int, int]:
    return tuple(int(color[i : i + 2], 16) for i in (1, 3, 5))


def _text_layer(row, catalog, fonts_dir: Path, short: int, pos: str):
    lines = []
    if _get(row, "wm_text"):
        lines.append(("main", row["wm_text"]))
    if _get(row, "wm_show_date"):
        d = date_text(row)
        if d:
            lines.append(("date", d))
    if not lines:
        return None
    size = next(z for z in catalog["watermark"]["sizes"] if z["id"] == row["wm_size"])
    px = max(12, round(short * size["text"]))
    font_def = next((f for f in catalog["frame_fonts"] if f["id"] == row["wm_font"]), catalog["frame_fonts"][0])
    main = _font(str(fonts_dir / font_def["file"]), px, font_def.get("wght"))
    small = _font(str(fonts_dir / "InstrumentSans.ttf"), max(10, round(px * (0.48 if len(lines) > 1 else 0.7))), 600)
    rendered = []
    for kind, text in lines:
        f = main if kind == "main" else small
        text = text if kind == "main" else "  ".join(text)  # letter-spaced date
        x0, y0, x1, y1 = f.getbbox(text)
        rendered.append((f, text, x1 - x0, y1 - y0, x0, y0))
    gap = round(px * 0.28)
    width = max(r[2] for r in rendered)
    height = sum(r[3] for r in rendered) + gap * (len(rendered) - 1)
    pad = round(px * 0.5)
    layer = Image.new("RGBA", (width + pad * 2, height + pad * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    rgb = _hex(row["wm_color"])
    alpha = round(255 * row["wm_opacity"] / 100)
    align = pos.rpartition("-")[2] if pos != "center" else "center"
    y = pad
    shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    dark_text = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255 < 0.45
    shade = (255, 255, 255) if dark_text else (0, 0, 0)
    for f, text, w, h, ox, oy in rendered:
        x = pad + (0 if align == "left" else width - w if align == "right" else (width - w) // 2)
        sdraw.text((x - ox, y - oy + max(1, px // 28)), text, font=f, fill=(*shade, round(alpha * 0.55)))
        draw.text((x - ox, y - oy), text, font=f, fill=(*rgb, alpha))
        y += h + gap
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(1, px * 0.08)))
    return Image.alpha_composite(shadow, layer), pad


def _image_layer(row, catalog, media_folder: Path, short: int):
    name = _get(row, "wm_image")
    if not name or not (media_folder / name).is_file():
        return None
    logo = Image.open(media_folder / name).convert("RGBA")
    size = next(z for z in catalog["watermark"]["sizes"] if z["id"] == row["wm_size"])
    target = max(16, round(short * size["image"]))
    scale = min(target / logo.width, target * 0.8 / logo.height)
    logo = logo.resize((max(1, round(logo.width * scale)), max(1, round(logo.height * scale))), Image.LANCZOS)
    if row["wm_opacity"] < 100:
        a = logo.getchannel("A").point(lambda v: round(v * row["wm_opacity"] / 100))
        logo.putalpha(a)
    return logo, 0


def parse_inner(value: str | None, w: int, h: int) -> tuple[int, int, int, int]:
    """Photo area inside a framed image (x, y, w, h in pixels); the whole image when unknown."""
    try:
        x, y, iw, ih = (float(v) for v in (value or "").split(","))
        if 0 <= x < 1 and 0 <= y < 1 and 0 < iw <= 1 - x + 1e-6 and 0 < ih <= 1 - y + 1e-6:
            return round(x * w), round(y * h), round(iw * w), round(ih * h)
    except ValueError:
        pass
    return 0, 0, w, h


def apply(img: Image.Image, row, catalog, fonts_dir: Path, media_folder: Path, inner: str | None = None) -> Image.Image:
    """Return `img` with the event's watermark drawn inside its photo area."""
    w, h = img.size
    box = parse_inner(inner, w, h)
    short = min(box[2], box[3])
    pos = row["wm_pos_landscape"] if box[2] > box[3] else row["wm_pos_portrait"]
    made = _image_layer(row, catalog, media_folder, short) if row["wm_mode"] == "image" else _text_layer(row, catalog, fonts_dir, short, pos)
    if made is None:
        return img
    layer, pad = made
    margin = round(short * 0.045) - pad
    x, y = _place(pos, box, layer.size, margin)
    out = img.convert("RGBA")
    out.alpha_composite(layer, (max(0, x), max(0, y)))
    return out.convert("RGB")


def cached_path(folder: Path, photo_id: str, h: str, thumb: bool) -> Path:
    return folder / (f"{photo_id}_t.w{h}.webp" if thumb else f"{photo_id}.w{h}.jpg")


def ensure(folder: Path, photo, event, catalog, fonts_dir: Path, thumb: bool = False) -> Path:
    """Path of the watermarked copy of `photo`, rendering it first if needed."""
    h = wm_hash(event)
    full = cached_path(folder, photo["id"], h, False)
    if not full.is_file():
        with Image.open(folder / f"{photo['id']}.jpg") as src:
            marked = apply(ImageOps.exif_transpose(src).convert("RGB"), event, catalog, fonts_dir, folder, photo["inner"])
        tmp = full.with_suffix(".tmp")
        marked.save(tmp, "JPEG", quality=90, optimize=True, progressive=True)
        tmp.replace(full)
    if not thumb:
        return full
    small = cached_path(folder, photo["id"], h, True)
    if not small.is_file():
        with Image.open(full) as im:
            im.thumbnail((THUMB_MAX, THUMB_MAX), Image.LANCZOS)
            tmp = small.with_suffix(".tmp")
            im.save(tmp, "WEBP", quality=80, method=4)
            tmp.replace(small)
    return small


def clear_cache(folder: Path) -> None:
    if folder.is_dir():
        for f in folder.glob("*.w*.*"):
            f.unlink(missing_ok=True)


def save_logo(data: bytes, folder: Path, name: str) -> None:
    """Store an uploaded logo as a transparent PNG, at most 1200 px wide."""
    import io

    from fastapi import HTTPException
    from PIL import UnidentifiedImageError

    try:
        im = Image.open(io.BytesIO(data))
        if im.format not in ("PNG", "WEBP"):
            raise HTTPException(415, "Logo watermark harus berupa PNG (sebaiknya transparan)")
        im.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(415, "File logo tidak valid")
    im = im.convert("RGBA")
    im.thumbnail((1200, 1200), Image.LANCZOS)
    folder.mkdir(parents=True, exist_ok=True)
    im.save(folder / name, "PNG", optimize=True)
