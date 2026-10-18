from conftest import CSRF, register


def test_host_registers_and_is_logged_in(client):
    register(client, email="Ani@Example.com", name="Ani")
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"] == {"name": "Ani", "email": "ani@example.com"}


def test_login_rejects_wrong_password_and_logout_ends_session(client):
    register(client, email="ani@example.com")
    client.post("/api/auth/logout", headers=CSRF)
    assert client.get("/api/auth/me").status_code == 401
    bad = client.post("/api/auth/login", json={"email": "ani@example.com", "password": "salah-banget"}, headers=CSRF)
    assert bad.status_code == 401
    ok = client.post("/api/auth/login", json={"email": "ANI@example.com", "password": "rahasia-123"}, headers=CSRF)
    assert ok.status_code == 200
    assert client.get("/api/auth/me").json()["user"]["email"] == "ani@example.com"


def test_email_can_only_register_once(client):
    register(client, email="ani@example.com")
    again = client.post("/api/auth/register", json={"name": "X", "email": "ani@example.com", "password": "rahasia-123"}, headers=CSRF)
    assert again.status_code == 409


def test_mutations_without_csrf_header_are_refused(client):
    r = client.post("/api/auth/register", json={"name": "X", "email": "x@example.com", "password": "rahasia-123"})
    assert r.status_code == 403
