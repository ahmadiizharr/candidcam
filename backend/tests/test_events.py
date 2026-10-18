from conftest import CSRF, create_event, register


def test_new_event_gets_sensible_defaults_and_a_display_passcode(client):
    register(client)
    ev = create_event(client)
    assert ev["slug"] == "budi-sinta"
    assert ev["public_url"] == "https://cam.test/budi-sinta"
    assert ev["language"] == "id"
    assert ev["theme"] == "dark_elegant"
    assert ev["aspect_ratio"] == "3:4"
    assert ev["frame_style"] == "none"
    assert ev["participant_limit"] == 5
    assert ev["max_photos_per_guest"] == 10
    assert len(ev["filters"]) == 15
    assert ev["display_passcode"].isdigit() and len(ev["display_passcode"]) == 6
    assert ev["status"] == "open"
    listed = client.get("/api/events").json()["events"]
    assert [e["id"] for e in listed] == [ev["id"]]


def test_event_settings_are_validated_against_the_catalog(client):
    register(client)
    bad = client.post("/api/events", json={"name": "X", "slug": "acara-x", "filters": ["bukan_filter"]}, headers=CSRF)
    assert bad.status_code == 422
    bad = client.post("/api/events", json={"name": "X", "slug": "acara-x", "filters": []}, headers=CSRF)
    assert bad.status_code == 422
    bad = client.post("/api/events", json={"name": "X", "slug": "acara-x", "max_photos_per_guest": 7}, headers=CSRF)
    assert bad.status_code == 422


def test_slug_must_be_unique_and_not_reserved(client):
    register(client)
    create_event(client)
    assert client.get("/api/events/check-slug", params={"slug": "budi-sinta"}).json() == {"available": False, "reason": "taken"}
    assert client.get("/api/events/check-slug", params={"slug": "app"}).json() == {"available": False, "reason": "reserved"}
    assert client.get("/api/events/check-slug", params={"slug": "Ab"}).json() == {"available": False, "reason": "invalid"}
    assert client.get("/api/events/check-slug", params={"slug": "rafi-nadia"}).json() == {"available": True, "reason": None}
    dup = client.post("/api/events", json={"name": "Lain", "slug": "budi-sinta"}, headers=CSRF)
    assert dup.status_code == 409


def test_hosts_only_see_their_own_events(client):
    register(client, email="a@example.com")
    ev = create_event(client)
    client.post("/api/auth/logout", headers=CSRF)
    register(client, email="b@example.com")
    assert client.get("/api/events").json()["events"] == []
    assert client.get(f"/api/events/{ev['id']}").status_code == 404
    assert client.patch(f"/api/events/{ev['id']}", json={"name": "Dibajak"}, headers=CSRF).status_code == 404


def test_host_can_update_settings(client):
    register(client)
    ev = create_event(client)
    r = client.patch(
        f"/api/events/{ev['id']}",
        json={"name": "Resepsi Budi", "theme": "scrapbook", "participant_limit": None, "frame_style": "polaroid", "frame_caption": "Our Day"},
        headers=CSRF,
    )
    assert r.status_code == 200, r.text
    got = client.get(f"/api/events/{ev['id']}").json()
    assert (got["name"], got["theme"], got["participant_limit"], got["frame_style"], got["frame_caption"]) == (
        "Resepsi Budi", "scrapbook", None, "polaroid", "Our Day",
    )


def test_schedule_end_must_be_after_start(client):
    register(client)
    r = client.post(
        "/api/events",
        json={"name": "X", "slug": "acara-x", "starts_at": "2026-10-20T10:00:00Z", "ends_at": "2026-10-20T09:00:00Z"},
        headers=CSRF,
    )
    assert r.status_code == 422
