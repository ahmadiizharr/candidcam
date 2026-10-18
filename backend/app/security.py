"""Password hashing, random tokens, and the per-install signing key."""

import base64
import hashlib
import hmac
import os
import secrets
from pathlib import Path

_N, _R, _P = 2**14, 8, 1


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt:{_N}:{_R}:{_P}:{b64(salt)}:{b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, expected = stored.split(":")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=32)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(dk, _unb64(expected))


# Dipakai untuk menyamakan waktu respons login saat email tidak terdaftar.
DUMMY_HASH = hash_password(secrets.token_hex(8))


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    """Tokens are stored hashed, so a leaked database can't be replayed as live sessions."""
    return hashlib.sha256(token.encode()).hexdigest()


def sign(secret: bytes, message: str) -> str:
    return b64(hmac.new(secret, message.encode(), hashlib.sha256).digest())[:32]


def load_secret(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        path.parent.mkdir(parents=True, exist_ok=True)
        key = secrets.token_bytes(32)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(key)
        return key
