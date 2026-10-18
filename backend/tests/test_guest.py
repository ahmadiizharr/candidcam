import io

from PIL import Image

from conftest import CSRF, create_event, join, jpeg, register


def upload(client, token, slug="budi-sinta", data=None, source="camera", filter="none"):
    return client.post(
        f"/api/g/{slug}/photos",
        files={"photo": ("photo.jpg", data or jpeg(), "image/jpeg")},
        data={"source": source, "filter": filter},
        headers={"X-Guest-Token": token},
    )


def test_guest_page_shows_public_info_but_never_the_passcode(client):
    register(client)
    create_event(client, participant_limit=5)
    client.cookies.clear()
    r = client.get("/api/g/budi-sinta")
    assert r.status_code == 200
    ev = r.json()["event"]
    assert ev["name"] == "Pernikahan Budi & Sinta"
    assert (ev["guests_count"], ev["participant_limit"], ev["quota_full"]) == (0, 5, False)
    assert "display_passcode" not in ev
    assert client.get("/api/g/tidak-ada").status_code == 404


def test_joining_stops_when_participant_quota_is_full(client):
    register(client)
    create_event(client, participant_limit=5)
    for i in range(5):
        join(client, name=f"Tamu {i}")
    full = client.post("/api/g/budi-sinta/join", json={"name": "Telat"})
    assert full.status_code == 409
    assert client.get("/api/g/budi-sinta").json()["event"]["quota_full"] is True


def test_unlimited_participants(client):
    register(client)
    create_event(client, participant_limit=None)
    for i in range(7):
        join(client, name=f"Tamu {i}")
    assert client.get("/api/g/budi-sinta").json()["event"]["guests_count"] == 7


def test_guest_session_tracks_remaining_shots(client):
    register(client)
    create_event(client, max_photos_per_guest=3)
    token = join(client, name="  Rina  ")
    s = client.get("/api/g/budi-sinta/session", headers={"X-Guest-Token": token}).json()["guest"]
    assert (s["name"], s["photos_taken"], s["photos_left"]) == ("Rina", 0, 3)
    assert upload(client, token).status_code == 200
    s = client.get("/api/g/budi-sinta/session", headers={"X-Guest-Token": token}).json()["guest"]
    assert (s["photos_taken"], s["photos_left"]) == (1, 2)
    assert client.get("/api/g/budi-sinta/session", headers={"X-Guest-Token": "palsu"}).status_code == 401


def test_roll_runs_out_after_max_photos(client):
    register(client)
    create_event(client, max_photos_per_guest=3)
    token = join(client)
    for _ in range(3):
        assert upload(client, token).status_code == 200
    over = upload(client, token)
    assert over.status_code == 409


def test_stored_photo_is_reencoded_without_metadata(client, settings):
    register(client)
    ev = create_event(client)
    token = join(client)
    photo = upload(client, token, data=jpeg(exif_gps=True), filter="golden_hour").json()["photo"]
    assert photo["filter"] == "golden_hour"
    img = client.get(photo["url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    assert not Image.open(io.BytesIO(img.content)).getexif()
    assert client.get(photo["thumb_url"]).status_code == 200


def test_non_images_and_unknown_filters_are_rejected(client):
    register(client)
    create_event(client, filters=["none", "soft_glow"])
    token = join(client)
    assert upload(client, token, data=b"bukan gambar").status_code == 415
    assert upload(client, token, filter="cinema_deep").status_code == 422


def test_camera_closed_before_event_starts_and_after_it_ends(client):
    register(client)
    ev = create_event(client, starts_at="2099-01-01T10:00:00Z")
    token = join(client)
    assert client.get("/api/g/budi-sinta").json()["event"]["status"] == "not_started"
    assert upload(client, token).status_code == 403
    client.patch(f"/api/events/{ev['id']}", json={"starts_at": "2020-01-01T10:00:00Z", "ends_at": "2020-01-02T10:00:00Z"}, headers=CSRF)
    assert client.get("/api/g/budi-sinta").json()["event"]["status"] == "ended"
    assert upload(client, token).status_code == 403


def test_gallery_upload_only_when_host_allows_it(client):
    register(client)
    ev = create_event(client)
    token = join(client)
    assert upload(client, token, source="gallery").status_code == 403
    client.patch(f"/api/events/{ev['id']}", json={"allow_gallery_upload": True}, headers=CSRF)
    assert upload(client, token, source="gallery").json()["photo"]["source"] == "gallery"


def test_guest_sees_own_roll_and_everyone_when_allowed(client):
    register(client)
    ev = create_event(client)
    rina, budi = join(client, name="Rina"), join(client, name="Budi")
    upload(client, rina)
    upload(client, budi)
    upload(client, budi)
    mine = client.get("/api/g/budi-sinta/photos", params={"scope": "mine"}, headers={"X-Guest-Token": rina}).json()["photos"]
    assert [p["guest_name"] for p in mine] == ["Rina"]
    everyone = client.get("/api/g/budi-sinta/photos", params={"scope": "all"}, headers={"X-Guest-Token": rina}).json()["photos"]
    assert sorted(p["guest_name"] for p in everyone) == ["Budi", "Budi", "Rina"]
    client.patch(f"/api/events/{ev['id']}", json={"guest_can_see_others": False}, headers=CSRF)
    hidden = client.get("/api/g/budi-sinta/photos", params={"scope": "all"}, headers={"X-Guest-Token": rina})
    assert hidden.status_code == 403


def test_likes_toggle_per_guest(client):
    register(client)
    ev = create_event(client)
    rina, budi = join(client, name="Rina"), join(client, name="Budi")
    pid = upload(client, budi).json()["photo"]["id"]
    like = lambda t: client.post(f"/api/g/budi-sinta/photos/{pid}/like", headers={"X-Guest-Token": t}).json()  # noqa: E731
    assert like(rina) == {"liked": True, "likes_count": 1}
    assert like(budi) == {"liked": True, "likes_count": 2}
    assert like(rina) == {"liked": False, "likes_count": 1}
    client.patch(f"/api/events/{ev['id']}", json={"enable_likes": False}, headers=CSRF)
    assert client.post(f"/api/g/budi-sinta/photos/{pid}/like", headers={"X-Guest-Token": rina}).status_code == 403


def test_guest_token_from_one_event_does_not_work_on_another(client):
    register(client)
    create_event(client)
    create_event(client, name="Lain", slug="acara-lain")
    token = join(client)
    assert client.get("/api/g/acara-lain/session", headers={"X-Guest-Token": token}).status_code == 401


def test_gallery_uploads_are_unfiltered_even_if_original_is_off_for_the_camera(client):
    register(client)
    create_event(client, filters=["golden_hour"], allow_gallery_upload=True)
    token = join(client)
    assert upload(client, token, source="gallery", filter="none").status_code == 200
    assert upload(client, token, source="camera", filter="none").status_code == 422
