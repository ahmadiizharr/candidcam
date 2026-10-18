from conftest import CSRF, create_event, join, jpeg, register
from test_guest import upload


def unlock(client, event_id, passcode):
    return client.post(f"/api/display/{event_id}/unlock", json={"passcode": passcode})


def test_display_needs_the_passcode(client):
    register(client)
    ev = create_event(client)
    upload(client, join(client, name="Rina"))
    client.cookies.clear()
    assert client.get(f"/api/display/{ev['id']}/live").status_code == 403
    assert unlock(client, ev["id"], "000000" if ev["display_passcode"] != "000000" else "111111").status_code == 403
    token = unlock(client, ev["id"], ev["display_passcode"]).json()["token"]
    live = client.get(f"/api/display/{ev['id']}/live", headers={"X-Display-Token": token}).json()
    assert live["event"]["name"] == "Pernikahan Budi & Sinta"
    assert (live["guests_count"], live["photos_count"]) == (1, 1)
    assert [p["guest_name"] for p in live["photos"]] == ["Rina"]


def test_new_passcode_locks_out_old_screens(client):
    register(client)
    ev = create_event(client)
    token = unlock(client, ev["id"], ev["display_passcode"]).json()["token"]
    client.post(f"/api/events/{ev['id']}/display-passcode", headers=CSRF)
    client.cookies.clear()
    assert client.get(f"/api/display/{ev['id']}/live", headers={"X-Display-Token": token}).status_code == 403


def test_owner_opens_display_without_passcode(client):
    register(client)
    ev = create_event(client)
    assert client.get(f"/api/display/{ev['id']}/live").status_code == 200


def test_display_sorts_by_likes(client):
    register(client)
    ev = create_event(client)
    rina, budi = join(client, name="Rina"), join(client, name="Budi")
    first = upload(client, rina).json()["photo"]["id"]
    second = upload(client, budi).json()["photo"]["id"]
    client.post(f"/api/g/budi-sinta/photos/{first}/like", headers={"X-Guest-Token": budi})
    live = client.get(f"/api/display/{ev['id']}/live", params={"sort": "most_liked"}).json()
    assert [p["id"] for p in live["photos"]] == [first, second]
    live = client.get(f"/api/display/{ev['id']}/live", params={"sort": "newest"}).json()
    assert [p["id"] for p in live["photos"]] == [second, first]


def test_display_qr_points_at_the_guest_link(client):
    register(client)
    create_event(client)
    r = client.get("/api/g/budi-sinta/qr.svg")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
