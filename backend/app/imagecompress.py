"""Make stored pictures smaller, once, in place.

On startup (after duplicates are merged) and every few hours after that, every picture that hasn't been looked at yet is re-encoded: JPEG and WebP at a
good quality, PNG losslessly, anything bigger than MAX_SIDE pixels on its longest side scaled down, and camera metadata (location, device) dropped. The file keeps
its name and type, so every address already in a document keeps working. The result replaces the original only if it is clearly smaller; either way the
picture is marked done. The person's storage is counted from the picture's size, so what is saved is given back to them straight away.

KOKO_IMAGE_COMPRESS=0 turns it off; KOKO_IMAGE_MAX_SIDE (default 2560) and KOKO_IMAGE_QUALITY (default 82) change how hard it works.
Needs Pillow (pip install Pillow); without it this does nothing."""
import hashlib
import io
import os
import threading
import time

from .db import UPLOAD_DIR, connect

MAX_SIDE = int(os.environ.get("KOKO_IMAGE_MAX_SIDE", "2560"))
QUALITY = int(os.environ.get("KOKO_IMAGE_QUALITY", "82"))
MIN_GAIN = 0.95          # a result has to be at least 5% smaller to be worth replacing the original
EVERY = 6 * 3600


def recompress(data: bytes, ext: str) -> bytes | None:
    """The smaller version of a picture, or None if it can't or shouldn't be changed."""
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 120_000_000
    im = Image.open(io.BytesIO(data))
    if getattr(im, "n_frames", 1) > 1:
        return None   # animated: leave it alone
    im.load()
    icc = im.info.get("icc_profile")
    im = ImageOps.exif_transpose(im)   # (the rotation is applied, because the metadata that said "rotate" is dropped)
    if max(im.size) > MAX_SIDE:
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    out = io.BytesIO()
    if ext == "jpg":
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        im.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True, **({"icc_profile": icc} if icc else {}))
    elif ext == "png":
        im.save(out, "PNG", optimize=True, **({"icc_profile": icc} if icc else {}))
    elif ext == "webp":
        im.save(out, "WEBP", quality=QUALITY, method=4, **({"icc_profile": icc} if icc else {}))
    else:
        return None   # GIFs may be animated, and nothing else is stored
    res = out.getvalue()
    return res if len(res) <= len(data) * MIN_GAIN else None


def compress_pending() -> dict:
    done = saved = 0
    with connect() as db:
        rows = db.execute("SELECT name, size, hash FROM uploads WHERE compressed = 0 AND remote = 0").fetchall()
    for r in rows:
        name = r["name"]
        path = UPLOAD_DIR / name
        ext = name.rsplit(".", 1)[-1]
        try:
            data = path.read_bytes()
        except OSError:
            continue   # missing file: not ours to fix
        try:
            new = recompress(data, ext)
        except Exception:   # a damaged picture, or one too big to open safely: leave it as it is
            new = None
        if new is not None:
            tmp = path.with_name(name + ".tmp")
            try:
                tmp.write_bytes(new)
                os.replace(tmp, path)   # people loading the picture see the old one or the new one, never half of it
            except OSError:
                tmp.unlink(missing_ok=True)
                new = None
        with connect() as db:
            if new is not None:
                db.execute("UPDATE uploads SET size = ?, hash = ?, orig_hash = COALESCE(orig_hash, hash), compressed = 1 WHERE name = ?", (len(new), hashlib.sha256(new).hexdigest(), name))
                saved += len(data) - len(new)
                done += 1
            else:
                db.execute("UPDATE uploads SET compressed = 1 WHERE name = ?", (name,))
            db.commit()
    return {"smaller": done, "looked_at": len(rows), "bytes": saved}


def start(after: threading.Thread | None = None) -> None:
    if os.environ.get("KOKO_IMAGE_COMPRESS", "1") == "0":
        return
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("KokoDocs: pictures are not being made smaller (pip install Pillow to turn it on)", flush=True)
        return

    def run():
        if after is not None:
            after.join()   # duplicates are merged first, so nothing is made smaller twice
        while True:
            try:
                r = compress_pending()
                if r["looked_at"]:
                    print(f"KokoDocs: looked at {r['looked_at']} picture(s), made {r['smaller']} smaller, freeing {r['bytes']:,} bytes", flush=True)
            except Exception as e:  # never stop the app over housekeeping
                print("KokoDocs: picture compression skipped:", e, flush=True)
            time.sleep(EVERY)
    threading.Thread(target=run, daemon=True).start()
