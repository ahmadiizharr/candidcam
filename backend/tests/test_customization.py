from conftest import CSRF, create_event, register


def test_new_home_themes_and_accent_colour(client):
    register(client)
    ev = create_event(client, theme="ticket", accent_color="#2F6FED")
    assert (ev["theme"], ev["accent_color"]) == ("ticket", "#2f6fed")
    pub = client.get("/api/g/budi-sinta").json()["event"]
    assert (pub["theme"], pub["accent_color"]) == ("ticket", "#2f6fed")
    assert client.patch(f"/api/events/{ev['id']}", json={"accent_color": "biru"}, headers=CSRF).status_code == 422
    assert client.patch(f"/api/events/{ev['id']}", json={"theme": "tidak-ada"}, headers=CSRF).status_code == 422
    assert client.patch(f"/api/events/{ev['id']}", json={"accent_color": None}, headers=CSRF).json()["accent_color"] is None


def test_display_layout_and_palette(client):
    register(client)
    ev = create_event(client)
    assert (ev["display_layout"], ev["display_palette"]) == ("mosaic", "midnight")
    r = client.patch(f"/api/events/{ev['id']}", json={"display_layout": "cinema", "display_palette": "forest"}, headers=CSRF)
    assert (r.json()["display_layout"], r.json()["display_palette"]) == ("cinema", "forest")
    live = client.get(f"/api/display/{ev['id']}/live").json()["event"]
    assert (live["display_layout"], live["display_palette"]) == ("cinema", "forest")
    assert client.patch(f"/api/events/{ev['id']}", json={"display_layout": "carousel"}, headers=CSRF).status_code == 422
