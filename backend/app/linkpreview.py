"""Link previews: the title, description and picture of a web page, for the preview cards in documents and wikis.
Only signed-in people can ask, only the public internet is reachable (every redirect is checked), and size, time and rate are capped."""
import time
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from .routes import assert_public, must_user
from .security import RateLimiter

router = APIRouter(prefix="/api")
limiter = RateLimiter(60, 60)
MAX_HTML = 400 * 1024
TTL = 3600
CACHE: dict[str, tuple[float, dict]] = {}
MAX_CACHE = 500


class Meta(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ""
        self.icon = ""
        self._in_title = False
        self.done = False

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "title" and not self.title:
            self._in_title = True
        elif tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and "content" in a and key not in self.meta:
                self.meta[key] = a["content"].strip()
        elif tag == "link" and "icon" in a.get("rel", "").lower().split() and a.get("href") and not self.icon:
            self.icon = a["href"]
        elif tag == "link" and a.get("rel", "").lower() == "icon" and a.get("href") and not self.icon:
            self.icon = a["href"]

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag == "head":
            self.done = True

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def clean(s: str, n: int) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def web(url: str, base: str) -> str:
    if not url:
        return ""
    u = urljoin(base, url.strip())
    return u if urlparse(u).scheme in ("http", "https") and len(u) < 2000 else ""


async def fetch_page(url: str) -> tuple[str, str]:
    """(final address, the start of the page's HTML)"""
    headers = {"User-Agent": "Mozilla/5.0 (compatible; KokoDocs link preview)", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en"}
    async with httpx.AsyncClient(follow_redirects=False, timeout=httpx.Timeout(8.0, connect=5.0), headers=headers) as client:
        for _hop in range(4):   # redirects are followed by hand so each hop is checked
            await assert_public(url)
            async with client.stream("GET", url) as r:
                if r.is_redirect and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                if r.status_code >= 400:
                    raise HTTPException(422, f"The page said {r.status_code}")
                if "html" not in r.headers.get("content-type", "").lower():
                    raise HTTPException(422, "That link isn't a web page")
                raw = b""
                async for chunk in r.aiter_bytes():
                    raw += chunk
                    if len(raw) > MAX_HTML:
                        break
                enc = r.encoding or "utf-8"
                return url, raw.decode(enc, errors="replace")
    raise HTTPException(422, "Too many redirects")


@router.get("/link-preview")
async def link_preview(url: str = Query(max_length=2000), user=Depends(must_user)):
    url = url.strip()
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise HTTPException(422, "That isn't a web address")
    hit = CACHE.get(url)
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    if not limiter.allow(f"linkpreview:{user['id']}"):
        raise HTTPException(429, "Too many previews at once. Try again in a minute.")
    final, html = await fetch_page(url)
    p = Meta()
    try:
        p.feed(html)
    except Exception:   # a broken page still gives whatever was read before the break
        pass
    m = p.meta
    host = (urlparse(final).hostname or "").removeprefix("www.")
    out = {
        "url": url,
        "title": clean(m.get("og:title") or m.get("twitter:title") or p.title, 200),
        "description": clean(m.get("og:description") or m.get("twitter:description") or m.get("description") or "", 300),
        "image": web(m.get("og:image") or m.get("twitter:image") or m.get("twitter:image:src") or "", final),
        "site": clean(m.get("og:site_name") or host, 80),
        "favicon": web(p.icon or "/favicon.ico", final),
        "host": host,
    }
    if len(CACHE) >= MAX_CACHE:
        CACHE.pop(next(iter(CACHE)))
    CACHE[url] = (time.time(), out)
    return out
