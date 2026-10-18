"""SQLite access. One connection behind a lock: traffic is a few events at a time, and it
keeps quota checks (count, then insert) atomic without juggling transactions per thread."""

import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    couple_names TEXT,
    slug TEXT NOT NULL UNIQUE,
    cover TEXT,
    language TEXT NOT NULL,
    theme TEXT NOT NULL,
    aspect_ratio TEXT NOT NULL,
    filters TEXT NOT NULL,
    frame_style TEXT NOT NULL,
    frame_paper TEXT NOT NULL,
    frame_caption TEXT,
    frame_date TEXT,
    frame_hashtag TEXT,
    frame_font TEXT NOT NULL,
    frame_text_color TEXT NOT NULL,
    frame_date_format TEXT NOT NULL,
    participant_limit INTEGER,
    max_photos_per_guest INTEGER NOT NULL,
    allow_gallery_upload INTEGER NOT NULL,
    guest_can_see_others INTEGER NOT NULL,
    enable_likes INTEGER NOT NULL,
    starts_at TEXT,
    ends_at TEXT,
    display_passcode TEXT NOT NULL,
    accent_color TEXT,
    display_layout TEXT NOT NULL DEFAULT 'mosaic',
    display_palette TEXT NOT NULL DEFAULT 'midnight',
    wm_enabled INTEGER NOT NULL DEFAULT 0,
    wm_mode TEXT NOT NULL DEFAULT 'text',
    wm_text TEXT,
    wm_show_date INTEGER NOT NULL DEFAULT 1,
    wm_font TEXT NOT NULL DEFAULT 'playfair',
    wm_color TEXT NOT NULL DEFAULT '#ffffff',
    wm_opacity INTEGER NOT NULL DEFAULT 85,
    wm_size TEXT NOT NULL DEFAULT 'md',
    wm_pos_portrait TEXT NOT NULL DEFAULT 'bottom-right',
    wm_pos_landscape TEXT NOT NULL DEFAULT 'bottom-right',
    wm_image TEXT,
    allow_clean_download INTEGER NOT NULL DEFAULT 1,
    first_photo_at TEXT,
    photos_deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_user ON events(user_id);
CREATE TABLE IF NOT EXISTS guests (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guests_event ON guests(event_id);
CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    filter TEXT NOT NULL,
    source TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    likes_count INTEGER NOT NULL DEFAULT 0,
    inner TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_event ON photos(event_id, created_at);
CREATE INDEX IF NOT EXISTS photos_guest ON photos(guest_id);
CREATE TABLE IF NOT EXISTS likes (
    photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    PRIMARY KEY (photo_id, guest_id)
);
"""


# (table, column, declaration) for every column added after the first release.
ADDED_COLUMNS = [
    ("events", "couple_names", "TEXT"),
    ("events", "accent_color", "TEXT"),
    ("events", "display_layout", "TEXT NOT NULL DEFAULT 'mosaic'"),
    ("events", "display_palette", "TEXT NOT NULL DEFAULT 'midnight'"),
    ("events", "wm_enabled", "INTEGER NOT NULL DEFAULT 0"),
    ("events", "wm_mode", "TEXT NOT NULL DEFAULT 'text'"),
    ("events", "wm_text", "TEXT"),
    ("events", "wm_show_date", "INTEGER NOT NULL DEFAULT 1"),
    ("events", "wm_font", "TEXT NOT NULL DEFAULT 'playfair'"),
    ("events", "wm_color", "TEXT NOT NULL DEFAULT '#ffffff'"),
    ("events", "wm_opacity", "INTEGER NOT NULL DEFAULT 85"),
    ("events", "wm_size", "TEXT NOT NULL DEFAULT 'md'"),
    ("events", "wm_pos_portrait", "TEXT NOT NULL DEFAULT 'bottom-right'"),
    ("events", "wm_pos_landscape", "TEXT NOT NULL DEFAULT 'bottom-right'"),
    ("events", "wm_image", "TEXT"),
    ("events", "allow_clean_download", "INTEGER NOT NULL DEFAULT 1"),
    ("photos", "inner", "TEXT"),
]


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class DB:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.executescript(SCHEMA)
        self._migrate()
        self.lock = threading.RLock()

    def _migrate(self):
        """Columns added after the first release; CREATE TABLE IF NOT EXISTS skips old tables."""
        for table, column, decl in ADDED_COLUMNS:
            cols = {r[1] for r in self.conn.execute(f"PRAGMA table_info({table})")}
            if column not in cols:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")

    @contextmanager
    def tx(self):
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            self.conn.execute("COMMIT")

    def one(self, sql: str, *args) -> sqlite3.Row | None:
        with self.lock:
            return self.conn.execute(sql, args).fetchone()

    def all(self, sql: str, *args) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, args).fetchall()

    def run(self, sql: str, *args) -> int:
        with self.lock:
            return self.conn.execute(sql, args).rowcount

    def close(self):
        self.conn.close()
