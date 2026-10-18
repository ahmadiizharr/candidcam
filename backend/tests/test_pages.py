from conftest import create_event, register


def test_guest_link_serves_the_guest_app_with_the_event_theme(client):
    register(client)
    create_event(client, theme="scrapbook")
    r = client.get("/budi-sinta")
    assert r.status_code == 200 and "guest" in r.text
    assert '<meta name="theme-color" content="#f3e9d6" />' in r.text
    assert "Pernikahan Budi &amp; Sinta" in r.text
    assert client.get("/budi-sinta/camera").status_code == 200


def test_routes_for_each_app_page(client):
    assert "index" in client.get("/").text
    assert "app" in client.get("/app/events/new").text
    assert "display" in client.get("/display/0123456789abcdef0123456789abcdef").text


def test_unknown_pages_are_404(client):
    r = client.get("/tidak-ada-acara")
    assert r.status_code == 404 and "404" in r.text
    assert client.get("/api/nope").json() == {"detail": "Not Found"}
