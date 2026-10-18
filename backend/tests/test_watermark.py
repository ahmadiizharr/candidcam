import io
import zipfile

from PIL import Image, ImageStat

from conftest import CSRF, create_event, join, jpeg, register
from test_guest import upload

WM = {"wm_enabled": True, "wm_mode": "text", "wm_text": "Nadia & Rafi", "wm_color": "#ffffff", "wm_opacity": 100, "wm_size": "lg"}


def img(resp):
    assert resp.status_code == 200, resp.text
    return Image.open(io.BytesIO(resp.content)).convert("L")


def busy(im, box):
    """Standard deviation of a region in 0-1 coordinates: ~0 on a flat colour, high where something is drawn."""
    w, h = im.size
    return ImageStat.Stat(im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))).stddev[0]


BOTTOM_RIGHT = (0.55, 0.8, 1, 1)
TOP_LEFT = (0, 0, 0.45, 0.2)


def setup(client, **wm):
    register(client)
    ev = create_event(client, **{**WM, **wm})
    token = join(client)
    return ev, token


def test_without_watermark_photos_are_served_as_uploaded(client):
    register(client)
    create_event(client)
    p = upload(client, join(client)).json()["photo"]
    assert p["url"].endswith(f"/{p['id']}.jpg")
    assert busy(img(client.get(p["url"])), BOTTOM_RIGHT) < 2


def test_text_watermark_is_drawn_on_shared_photos(client):
    ev, token = setup(client)
    p = upload(client, token).json()["photo"]
    assert ".w" in p["url"] and ".w" in p["thumb_url"]
    shown = img(client.get(p["url"]))
    assert busy(shown, BOTTOM_RIGHT) > 8
    assert busy(shown, TOP_LEFT) < 2
    assert client.get(p["thumb_url"]).status_code == 200


def test_watermark_follows_the_orientation_setting(client):
    ev, token = setup(client, wm_pos_portrait="bottom-right", wm_pos_landscape="top-left")
    land = upload(client, token, data=jpeg(800, 600)).json()["photo"]
    shown = img(client.get(land["url"]))
    assert busy(shown, TOP_LEFT) > 8 and busy(shown, BOTTOM_RIGHT) < 2


def test_watermark_stays_inside_the_photo_area_of_a_framed_shot(client):
    ev, token = setup(client)
    # A polaroid: the photo fills the top 75%, the paper strip below must stay clean.
    r = client.post(
        "/api/g/budi-sinta/photos",
        files={"photo": ("p.jpg", jpeg(600, 800), "image/jpeg")},
        data={"source": "camera", "filter": "none", "inner": "0.05,0.04,0.9,0.71"},
        headers={"X-Guest-Token": token},
    )
    shown = img(client.get(r.json()["photo"]["url"]))
    assert busy(shown, (0, 0.8, 1, 1)) < 2
    assert busy(shown, (0.5, 0.55, 0.95, 0.75)) > 8


def test_clean_original_is_private_while_watermarking(client):
    ev, token = setup(client)
    p = upload(client, token).json()["photo"]
    clean = f"/media/{ev['id']}/{p['id']}.jpg"
    assert client.get(clean).status_code == 200  # the logged-in owner
    client.cookies.clear()
    assert client.get(clean).status_code == 404
    assert client.get(f"/media/{ev['id']}/{p['id']}_t.webp").status_code == 404


def test_guests_download_without_watermark_only_when_allowed(client):
    ev, token = setup(client, allow_clean_download=True)
    p = upload(client, token).json()["photo"]
    base = f"/api/g/budi-sinta/photos/{p['id']}/download"
    assert busy(img(client.get(base)), BOTTOM_RIGHT) > 8
    assert busy(img(client.get(base, params={"clean": 1})), BOTTOM_RIGHT) < 2
    client.patch(f"/api/events/{ev['id']}", json={"allow_clean_download": False}, headers=CSRF)
    client.cookies.clear()
    assert client.get(base, params={"clean": 1}).status_code == 403


def test_host_downloads_original_or_watermarked_and_zip(client):
    ev, token = setup(client, allow_clean_download=False)
    p = upload(client, token).json()["photo"]
    base = f"/api/events/{ev['id']}/photos/{p['id']}/download"
    assert busy(img(client.get(base, params={"clean": 1})), BOTTOM_RIGHT) < 2
    assert busy(img(client.get(base)), BOTTOM_RIGHT) > 8
    for flag, marked in ((0, False), (1, True)):
        z = zipfile.ZipFile(io.BytesIO(client.get(f"/api/events/{ev['id']}/photos.zip", params={"watermark": flag}).content))
        im = Image.open(io.BytesIO(z.read(z.namelist()[0]))).convert("L")
        assert (busy(im, BOTTOM_RIGHT) > 8) is marked


def test_changing_the_watermark_changes_the_photo_url(client):
    ev, token = setup(client)
    old = upload(client, token).json()["photo"]["url"]
    client.patch(f"/api/events/{ev['id']}", json={"wm_text": "Sampai jumpa"}, headers=CSRF)
    new = client.get("/api/g/budi-sinta/photos", params={"scope": "mine"}, headers={"X-Guest-Token": token}).json()["photos"][0]["url"]
    assert new != old
    assert client.get(old).status_code == 404
    assert client.get(new).status_code == 200


def test_png_logo_watermark(client):
    ev, token = setup(client, wm_mode="image")
    logo = Image.new("RGBA", (300, 120), (0, 0, 0, 0))
    logo.paste((20, 40, 200, 255), (20, 20, 280, 100))
    buf = io.BytesIO()
    logo.save(buf, "PNG")
    r = client.post(f"/api/events/{ev['id']}/watermark", files={"image": ("logo.png", buf.getvalue(), "image/png")}, headers=CSRF)
    assert r.status_code == 200 and r.json()["wm_image_url"].endswith(".png")
    p = upload(client, token).json()["photo"]
    assert busy(img(client.get(p["url"])), BOTTOM_RIGHT) > 8
    assert client.post(f"/api/events/{ev['id']}/watermark", files={"image": ("x.png", b"nope", "image/png")}, headers=CSRF).status_code == 415
    assert client.delete(f"/api/events/{ev['id']}/watermark", headers=CSRF).json()["wm_image_url"] is None


def test_watermark_preview_for_the_wizard(client):
    register(client)
    r = client.post(
        "/api/watermark/preview",
        data={"settings": '{"wm_enabled": true, "wm_text": "Halo", "wm_show_date": true, "frame_date": "2026-10-18"}', "orientation": "landscape"},
        headers=CSRF,
    )
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    im = Image.open(io.BytesIO(r.content))
    assert im.width > im.height
    client.cookies.clear()
    assert client.post("/api/watermark/preview", data={"settings": "{}"}, headers=CSRF).status_code == 401
