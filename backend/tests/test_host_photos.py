import io
import zipfile

from conftest import CSRF, create_event, join, register
from test_guest import upload


def test_host_sees_guests_and_photos_and_can_delete_one(client):
    register(client)
    ev = create_event(client)
    rina = join(client, name="Rina")
    join(client, name="Budi")
    pid = upload(client, rina).json()["photo"]["id"]
    upload(client, rina)
    guests = client.get(f"/api/events/{ev['id']}/guests").json()["guests"]
    assert [(g["name"], g["photos_count"]) for g in guests] == [("Rina", 2), ("Budi", 0)]
    assert client.get(f"/api/events/{ev['id']}").json()["photos_count"] == 2
    assert client.delete(f"/api/events/{ev['id']}/photos/{pid}", headers=CSRF).status_code == 200
    assert len(client.get(f"/api/events/{ev['id']}/photos").json()["photos"]) == 1
    assert client.get(f"/media/{ev['id']}/{pid}.jpg").status_code == 404


def test_host_downloads_every_photo_as_zip(client):
    register(client)
    ev = create_event(client)
    rina = join(client, name="Rina")
    upload(client, rina)
    upload(client, rina)
    r = client.get(f"/api/events/{ev['id']}/photos.zip")
    assert r.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert names == ["001-Rina.jpg", "002-Rina.jpg"]


def test_cover_photo_upload_and_removal(client):
    from conftest import jpeg

    register(client)
    ev = create_event(client)
    r = client.post(f"/api/events/{ev['id']}/cover", files={"photo": ("c.jpg", jpeg(1200, 900), "image/jpeg")}, headers=CSRF)
    cover = r.json()["cover_url"]
    assert cover.endswith(".webp")
    assert client.get(cover).headers["content-type"] == "image/webp"
    assert client.get("/api/g/budi-sinta").json()["event"]["cover_url"] == cover
    client.delete(f"/api/events/{ev['id']}/cover", headers=CSRF)
    assert client.get(cover).status_code == 404


def test_deleting_an_event_removes_its_guest_page(client):
    register(client)
    ev = create_event(client)
    client.delete(f"/api/events/{ev['id']}", headers=CSRF)
    assert client.get("/api/g/budi-sinta").status_code == 404
