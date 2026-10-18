"""Host accounts: email + password, opaque session token in an HttpOnly cookie."""

import re
import secrets
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .db import DB, iso, now
from .security import DUMMY_HASH, hash_password, new_token, token_digest, verify_password

COOKIE = "cc_session"
# Host requests that change state must carry this header. Browsers only let same-origin
# scripts set custom headers, so together with SameSite=Lax it blocks CSRF.
CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "candid"
EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(max_length=254)
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


def user_public(row) -> dict:
    return {"name": row["name"], "email": row["email"]}


def current_user(request: Request):
    """The logged-in host, or None. Does not enforce CSRF (safe for GET)."""
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    db: DB = request.app.state.db
    return db.one(
        "SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
        token_digest(token),
        iso(now()),
    )


def require_user(request: Request):
    user = current_user(request)
    if user is None:
        raise HTTPException(401, "Silakan masuk dulu")
    if request.method not in ("GET", "HEAD") and request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise HTTPException(403, "Permintaan ditolak")
    return user


def _check_csrf(request: Request):
    if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
        raise HTTPException(403, "Permintaan ditolak")


def create_router(days: int) -> APIRouter:
    r = APIRouter(prefix="/api/auth")

    def start_session(request: Request, response: Response, user_id: str):
        token = new_token()
        request.app.state.db.run(
            "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            token_digest(token),
            user_id,
            iso(now() + timedelta(days=days)),
        )
        secure = request.url.scheme == "https"
        response.set_cookie(COOKIE, token, max_age=days * 86400, httponly=True, secure=secure, samesite="lax", path="/")

    @r.post("/register")
    def register(body: RegisterIn, request: Request, response: Response):
        _check_csrf(request)
        email = body.email.strip().lower()
        if not EMAIL.match(email):
            raise HTTPException(422, "Format email tidak valid")
        db: DB = request.app.state.db
        user_id = secrets.token_hex(12)
        with db.tx() as c:
            if c.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                raise HTTPException(409, "Email ini sudah terdaftar. Silakan masuk.")
            c.execute(
                "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, email, body.name.strip(), hash_password(body.password), iso(now())),
            )
        start_session(request, response, user_id)
        return {"user": {"name": body.name.strip(), "email": email}}

    @r.post("/login")
    def login(body: LoginIn, request: Request, response: Response):
        _check_csrf(request)
        db: DB = request.app.state.db
        row = db.one("SELECT * FROM users WHERE email = ?", body.email.strip().lower())
        ok = verify_password(body.password, row["password_hash"] if row else DUMMY_HASH)
        if not row or not ok:
            raise HTTPException(401, "Email atau password salah")
        start_session(request, response, row["id"])
        return {"user": user_public(row)}

    @r.post("/logout")
    def logout(request: Request, response: Response):
        _check_csrf(request)
        token = request.cookies.get(COOKIE)
        if token:
            request.app.state.db.run("DELETE FROM auth_sessions WHERE token_hash = ?", token_digest(token))
        response.delete_cookie(COOKIE, path="/")
        return {"ok": True}

    @r.get("/me")
    def me(request: Request):
        user = current_user(request)
        if user is None:
            raise HTTPException(401, "Belum masuk")
        return {"user": user_public(user)}

    return r
