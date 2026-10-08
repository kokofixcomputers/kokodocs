# Allow `python backend/app/main.py` (some hosts only let you pick a start file): hand off to run.py.
if __name__ == "__main__" and not __package__:
    import runpy
    import sys
    from pathlib import Path

    runpy.run_path(str(Path(__file__).resolve().parents[2] / "run.py"), run_name="__main__")
    sys.exit(0)

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from .ai import router as ai_router
from .collab import router as collab_router
from .library import router as library_router
from .versions import router as versions_router
from .comments import router as comments_router
from .admin import router as admin_router
from .authx import router as authx_router
from .search import router as search_router
from .forms import router as forms_router
from .tags import router as tags_router
from .wikiproxy import router as wikiproxy_router
from . import forms
from .notifications import router as notifications_router
from . import imagededupe, searchindex, snapshots
from .emailauth import router as emailauth_router
from .db import init_db
from .routes import router

init_db()
searchindex.start_backfill()
snapshots.start_compaction()
imagededupe.start_merge()
forms.start_sweeper()
app = FastAPI(title="KokoDocs", docs_url="/api/docs-ui", openapi_url="/api/openapi.json")
class SelectiveGZip:
    """Compress text responses (the JS bundles, JSON). Images and emoji are already compressed, and streams are left alone."""
    SKIP = ("/api/images/", "/twemoji/", "/ws/", "/api/ai/chat")

    def __init__(self, app):
        self.plain, self.zipped = app, GZipMiddleware(app, minimum_size=1024, compresslevel=6)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and not scope["path"].startswith(self.SKIP):
            return await self.zipped(scope, receive, send)
        return await self.plain(scope, receive, send)


app.add_middleware(SelectiveGZip)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("KOKO_CORS", "http://localhost:5173,http://127.0.0.1:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(library_router)
app.include_router(versions_router)
app.include_router(comments_router)
app.include_router(admin_router)
app.include_router(authx_router)
app.include_router(search_router)
app.include_router(forms_router)
app.include_router(tags_router)
app.include_router(wikiproxy_router)
app.include_router(notifications_router)
app.include_router(emailauth_router)
app.include_router(ai_router)
app.include_router(collab_router)

# Serve the built React app from this same process (run `npm run build` in ../frontend).
# Real files in dist/ are served as-is; every other non-API path falls through to index.html
# so client-side routes like /d/<id> work on refresh and deep links.
DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
INDEX_HEADERS = {"Cache-Control": "no-cache"}

if (DIST / "index.html").exists():
    if (DIST / "assets").exists():
        app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")  # hashed filenames

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path == "api" or path.startswith(("api/", "ws/")):
            raise HTTPException(404, "Not found")
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST.resolve() in f.parents:
            return FileResponse(f, headers={"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("twemoji/") else None)   # the emoji files never change
        if path.startswith("twemoji/"):
            raise HTTPException(404, "No such emoji")   # not index.html: a page pretending to be a picture is what shows as a broken image
        return FileResponse(DIST / "index.html", headers=INDEX_HEADERS)
else:

    @app.get("/", include_in_schema=False)
    def no_frontend():
        return {"detail": "Frontend not built. Run `npm run build` in frontend/, or use dev.sh."}
