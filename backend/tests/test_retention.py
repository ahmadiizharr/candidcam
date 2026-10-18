import dataclasses

from fastapi.testclient import TestClient

from app.main import create_app
from app.retention import purge_expired
from conftest import create_event, join, register
from test_guest import upload


def test_photos_are_archived_after_the_retention_period(settings):
    settings = dataclasses.replace(settings, retention_days=0)
    app = create_app(settings)
    with TestClient(app, base_url="https://cam.test") as client:
        register(client)
        ev = create_event(client)
        photo = upload(client, join(client)).json()["photo"]
        assert purge_expired(app.state.db, settings) == 1
        got = client.get(f"/api/events/{ev['id']}").json()
        assert got["status"] == "archived" and got["photos_count"] == 0
        assert client.get(photo["url"]).status_code == 404
        assert client.get("/api/g/budi-sinta").json()["event"]["status"] == "archived"
