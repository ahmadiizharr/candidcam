import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import Settings
from app.main import create_app

CSRF = {"X-Requested-With": "candid"}


@pytest.fixture
def settings(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    for page in ("index", "app", "guest", "display", "404"):
        (dist / f"{page}.html").write_text(f"<html><head><meta name=\"theme-color\" content=\"#000000\" /><title>t</title></head><body>{page}</body></html>")
    return Settings(data_dir=tmp_path / "data", dist_dir=dist, public_base_url="https://cam.test")


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings), base_url="https://cam.test") as c:
        yield c


def jpeg(w=600, h=800, color=(200, 120, 40), exif_gps=False) -> bytes:
    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    kw = {}
    if exif_gps:
        exif = Image.Exif()
        exif[0x010F] = "SpyCam"  # Make
        kw["exif"] = exif.tobytes()
    img.save(buf, "JPEG", quality=90, **kw)
    return buf.getvalue()


def register(client, email="host@example.com", name="Host", password="rahasia-123"):
    r = client.post("/api/auth/register", json={"name": name, "email": email, "password": password}, headers=CSRF)
    assert r.status_code == 200, r.text
    return r.json()


def create_event(client, **over):
    body = {"name": "Pernikahan Budi & Sinta", "slug": "budi-sinta"}
    body.update(over)
    r = client.post("/api/events", json=body, headers=CSRF)
    assert r.status_code == 200, r.text
    return r.json()


def join(client, slug="budi-sinta", name="Tamu"):
    r = client.post(f"/api/g/{slug}/join", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["token"]
