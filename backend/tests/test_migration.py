import sqlite3

from fastapi.testclient import TestClient

from app import db as dbmod
from app.main import create_app
from conftest import CSRF, register


def test_database_from_before_couple_names_still_opens(settings):
    # A database created by the first release, which had no couple_names column.
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    old = sqlite3.connect(settings.db_path)
    old.executescript(dbmod.SCHEMA.replace("    couple_names TEXT,\n", ""))
    old.close()
    with TestClient(create_app(settings), base_url="https://cam.test") as client:
        register(client)
        r = client.post("/api/events", json={"name": "Lama", "slug": "acara-lama", "couple_names": "A & B"}, headers=CSRF)
        assert r.status_code == 200, r.text
        assert r.json()["couple_names"] == "A & B"
