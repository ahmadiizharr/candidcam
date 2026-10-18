import asyncio
import contextlib
import json
import logging
import mimetypes
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import auth, display, guest, host, pages, watermark
from .auth import current_user
from .retention import purge_expired
from .config import Settings
from .db import DB
from .security import load_secret

log = logging.getLogger("candid")
mimetypes.add_type("image/webp", ".webp")

MEDIA_ID = re.compile(r"^[0-9a-f]{32}$")
MEDIA_NAME = re.compile(
    r"^(?:(?P<pid>[A-Za-z0-9_-]{16})(?:\.jpg|_t\.webp|\.w(?P<h1>[0-9a-f]{10})\.jpg|_t\.w(?P<h2>[0-9a-f]{10})\.webp)"
    r"|cover-[0-9a-f]{8}\.webp|wm-[0-9a-f]{8}\.png)$"
)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.db = DB(settings.db_path)
        app.state.secret = load_secret(settings.secret_path)

        async def janitor():
            while True:
                try:
                    n = await asyncio.to_thread(purge_expired, app.state.db, settings)
                    if n:
                        log.info("archived %d events past retention", n)
                except Exception:
                    log.exception("retention purge failed")
                await asyncio.sleep(3600)

        task = asyncio.create_task(janitor())
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        app.state.db.close()

    app = FastAPI(title="candid-cam", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.state.settings = settings
    app.state.catalog = json.loads(settings.catalog_file.read_text())
    app.include_router(auth.create_router(settings.session_days))
    app.include_router(host.create_router())
    app.include_router(host.create_preview_router())
    app.include_router(guest.create_router())
    app.include_router(display.create_router())

    @app.get("/api/catalog")
    def catalog():
        return app.state.catalog

    @app.get("/media/{event_id}/{name}")
    def media_file(event_id: str, name: str, request: Request):
        m = MEDIA_NAME.match(name)
        if not MEDIA_ID.match(event_id) or not m:
            raise HTTPException(404, "Tidak ditemukan")
        folder = settings.media_dir / event_id
        forever = {"Cache-Control": "public, max-age=31536000, immutable"}
        if not m.group("pid"):  # cover or watermark logo
            path = folder / name
            if not path.is_file():
                raise HTTPException(404, "Tidak ditemukan")
            return FileResponse(path, headers=forever)
        db = app.state.db
        event = db.one("SELECT * FROM events WHERE id = ?", event_id)
        photo = db.one("SELECT * FROM photos WHERE id = ? AND event_id = ?", m.group("pid"), event_id)
        if event is None or photo is None:
            raise HTTPException(404, "Tidak ditemukan")
        version = m.group("h1") or m.group("h2")
        thumb = name.startswith(f"{photo['id']}_t")
        if version:
            # Only the current watermark version exists; older URLs simply stop resolving.
            if version != watermark.wm_hash(event):
                raise HTTPException(404, "Tidak ditemukan")
            path = watermark.ensure(folder, photo, event, app.state.catalog, settings.fonts_dir, thumb=thumb)
            return FileResponse(path, headers=forever)
        path = folder / name
        if not path.is_file():
            raise HTTPException(404, "Tidak ditemukan")
        if event["wm_enabled"]:
            # While watermarking, the clean original is the host's alone and must stay out of CDN caches.
            user = current_user(request)
            if not user or user["id"] != event["user_id"]:
                raise HTTPException(404, "Tidak ditemukan")
            return FileResponse(path, headers={"Cache-Control": "private, no-store"})
        return FileResponse(path, headers=forever)

    @app.exception_handler(StarletteHTTPException)
    async def not_found(request: Request, exc: StarletteHTTPException):
        if exc.status_code == 404 and not request.url.path.startswith(("/api/", "/media/", "/assets/")):
            return FileResponse(settings.dist_dir / "404.html", status_code=404, media_type="text/html")
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    # Hashed Vite bundles plus files from frontend/public (fonts, icons, sample photo).
    if (settings.dist_dir / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=settings.dist_dir / "assets"), name="assets")
    for name in ("static",):
        if (settings.dist_dir / name).is_dir():
            app.mount(f"/{name}", StaticFiles(directory=settings.dist_dir / name), name=name)

    # Last, so /{slug} never shadows an API or asset route.
    app.include_router(pages.create_router())
    return app
