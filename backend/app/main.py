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

from . import auth, display, guest, host, pages
from .retention import purge_expired
from .config import Settings
from .db import DB
from .security import load_secret

log = logging.getLogger("candid")
mimetypes.add_type("image/webp", ".webp")

MEDIA_ID = re.compile(r"^[0-9a-f]{32}$")
MEDIA_NAME = re.compile(r"^(?:[A-Za-z0-9_-]{16}(?:\.jpg|_t\.webp)|cover-[0-9a-f]{8}\.webp)$")


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
    app.include_router(guest.create_router())
    app.include_router(display.create_router())

    @app.get("/api/catalog")
    def catalog():
        return app.state.catalog

    @app.get("/media/{event_id}/{name}")
    def media_file(event_id: str, name: str):
        path = settings.media_dir / event_id / name
        if not MEDIA_ID.match(event_id) or not MEDIA_NAME.match(name) or not path.is_file():
            raise HTTPException(404, "Tidak ditemukan")
        # Names are random and never reused, so the bytes behind a URL never change.
        return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})

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
