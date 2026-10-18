"""Live display for a screen or projector at the venue. Unlocked with the event's passcode;
the token is a signature over the passcode, so a new passcode locks out old screens."""

import hmac
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from . import events, media, watermark
from .auth import current_user
from .security import sign


class UnlockIn(BaseModel):
    passcode: str = Field(max_length=12)


def _token(secret: bytes, event) -> str:
    return sign(secret, f"display:{event['id']}:{event['display_passcode']}")


def create_router() -> APIRouter:
    r = APIRouter(prefix="/api/display/{event_id}")

    def event_row(request: Request, event_id: str):
        row = request.app.state.db.one("SELECT * FROM events WHERE id = ?", event_id)
        if row is None:
            raise HTTPException(404, "Acara tidak ditemukan")
        return row

    @r.post("/unlock")
    def unlock(event_id: str, body: UnlockIn, request: Request):
        event = event_row(request, event_id)
        if not hmac.compare_digest(body.passcode.strip().encode(), event["display_passcode"].encode()):
            raise HTTPException(403, "Passcode salah")
        return {"token": _token(request.app.state.secret, event)}

    @r.get("/live")
    def live(
        event_id: str,
        request: Request,
        token: Annotated[str | None, Header(alias="X-Display-Token")] = None,
        sort: str = "newest",
        limit: int = 120,
    ):
        db, settings = request.app.state.db, request.app.state.settings
        event = event_row(request, event_id)
        user = current_user(request)
        is_owner = user is not None and user["id"] == event["user_id"]
        if not is_owner and not (token and hmac.compare_digest(token, _token(request.app.state.secret, event))):
            raise HTTPException(403, "Masukkan passcode display")
        counts = db.one(
            """SELECT (SELECT COUNT(*) FROM guests WHERE event_id = ?) AS guests_count,
                      (SELECT COUNT(*) FROM photos WHERE event_id = ?) AS photos_count""",
            event_id, event_id,
        )
        photos = media.list_photos(db, event_id, sort=sort, limit=max(1, min(limit, 500)), wm=watermark.wm_hash(event))
        return {
            "event": events.guest_view(event, settings.public_base_url, counts["guests_count"]),
            "guests_count": counts["guests_count"],
            "photos_count": counts["photos_count"],
            "photos": photos,
        }

    return r
