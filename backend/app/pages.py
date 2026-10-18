"""HTML entry points of the built frontend. Guest pages get the event's name and theme
colour baked in, so link previews and the phone's status bar match before any JS runs."""

import html
import re

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse

from . import events

SLUG_PATH = re.compile(r"^[a-z0-9-]{3,40}$")


def create_router() -> APIRouter:
    r = APIRouter()

    def dist(request: Request, page: str):
        return request.app.state.settings.dist_dir / f"{page}.html"

    def page(request: Request, name: str, status: int = 200):
        return FileResponse(dist(request, name), status_code=status, media_type="text/html", headers={"Cache-Control": "no-cache"})

    def not_found(request: Request):
        return page(request, "404", 404)

    @r.get("/", include_in_schema=False)
    def landing(request: Request):
        return page(request, "index")

    @r.get("/app", include_in_schema=False)
    @r.get("/app/{rest:path}", include_in_schema=False)
    def dashboard(request: Request, rest: str = ""):
        return page(request, "app")

    @r.get("/display/{event_id}", include_in_schema=False)
    def display(request: Request, event_id: str):
        if not re.fullmatch(r"[0-9a-f]{32}", event_id):
            return not_found(request)
        return page(request, "display")

    @r.get("/{slug}", include_in_schema=False)
    @r.get("/{slug}/camera", include_in_schema=False)
    def guest(request: Request, slug: str):
        slug = slug.lower()
        if not SLUG_PATH.match(slug):
            return not_found(request)
        row = request.app.state.db.one("SELECT name, theme FROM events WHERE slug = ?", slug)
        if row is None:
            return not_found(request)
        catalog = request.app.state.catalog
        color = next((t["color"] for t in catalog["themes"] if t["id"] == row["theme"]), "#0b0a0d")
        text = dist(request, "guest").read_text()
        text = re.sub(r'<meta name="theme-color" content="[^"]*" />', f'<meta name="theme-color" content="{color}" />', text, count=1)
        name = html.escape(row["name"])
        text = re.sub(r"<title>[^<]*</title>", f"<title>{name} · Candid Cam</title>", text, count=1)
        text = text.replace("</head>", f'<meta property="og:title" content="{name}" />\n</head>', 1)
        return HTMLResponse(text, headers={"Cache-Control": "no-cache"})

    return r
