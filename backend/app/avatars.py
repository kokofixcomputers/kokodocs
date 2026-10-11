"""Profile pictures: one small square WebP per person, shown wherever their initials would be (the top bar, who is here, comments, sharing)."""
import io
import time

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .db import DATA_DIR, get_db
from .routes import must_user
from . import access

router = APIRouter(prefix="/api")
AVATAR_DIR = DATA_DIR / "avatars"
SIZE = 256
MAX_UPLOAD = 8 * 1024 * 1024


def remove_file(uid: str) -> None:
    try:
        (AVATAR_DIR / f"{uid}.webp").unlink()
    except OSError:
        pass


@router.post("/me/avatar")
async def set_avatar(file: UploadFile = File(...), user=Depends(must_user), db=Depends(get_db)):
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise HTTPException(503, "Profile pictures need Pillow on the server (pip install Pillow)")
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise HTTPException(413, "That picture is too big (8 MB at most)")
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception:
        raise HTTPException(422, "That doesn't look like a picture we can read (use PNG, JPEG, WebP or GIF)")
    im = ImageOps.exif_transpose(im).convert("RGBA")
    im = ImageOps.fit(im, (SIZE, SIZE), Image.LANCZOS)   # centred square crop
    flat = Image.new("RGB", im.size, (255, 255, 255))
    flat.paste(im, mask=im.split()[3])
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    flat.save(AVATAR_DIR / f"{user['id']}.webp", "WEBP", quality=88)
    now = time.time()
    db.execute("UPDATE users SET avatar = ? WHERE id = ?", (now, user["id"]))
    db.commit()
    return {"avatar": access.avatar_url(user["id"], now)}


@router.delete("/me/avatar")
def clear_avatar(user=Depends(must_user), db=Depends(get_db)):
    db.execute("UPDATE users SET avatar = NULL WHERE id = ?", (user["id"],))
    db.commit()
    remove_file(user["id"])
    return {"avatar": None}


@router.get("/avatars/{uid}")
def get_avatar(uid: str, db=Depends(get_db)):
    if not uid.isalnum() or not db.execute("SELECT 1 FROM users WHERE id = ? AND avatar IS NOT NULL AND disabled = 0", (uid,)).fetchone():
        raise HTTPException(404, "No picture")
    path = AVATAR_DIR / f"{uid}.webp"
    if not path.exists():
        raise HTTPException(404, "No picture")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})
