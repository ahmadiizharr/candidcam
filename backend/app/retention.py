"""Guest photos are kept for a fixed period after an event's first photo, then removed."""

import logging
import shutil
from datetime import timedelta

from .config import Settings
from .db import DB, iso, now

log = logging.getLogger("candid")


def purge_expired(db: DB, settings: Settings) -> int:
    """Archive every event whose photos are past retention. Returns how many were archived."""
    cutoff = iso(now() - timedelta(days=settings.retention_days))
    rows = db.all(
        "SELECT id, cover FROM events WHERE photos_deleted_at IS NULL AND first_photo_at IS NOT NULL AND first_photo_at <= ?",
        cutoff,
    )
    for row in rows:
        with db.tx() as c:
            c.execute("DELETE FROM photos WHERE event_id = ?", (row["id"],))
            c.execute("UPDATE events SET photos_deleted_at = ? WHERE id = ?", (iso(now()), row["id"]))
        folder = settings.media_dir / row["id"]
        if folder.is_dir():
            for f in folder.iterdir():
                if f.name != row["cover"] and not f.name.startswith("wm-"):
                    f.unlink(missing_ok=True)
        log.info("archived photos of event %s", row["id"])
    db.run("DELETE FROM auth_sessions WHERE expires_at < ?", iso(now()))
    return len(rows)
