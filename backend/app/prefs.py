"""A person's own settings that follow them between devices: their text snippets, and which writing helpers (AI autocomplete and the like) are on.
Each is a small JSON value under a fixed name; the server only stores it."""
import json
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .db import get_db
from .routes import must_user

router = APIRouter(prefix="/api")
KEYS = {"snippets", "writing"}   # what can be stored
MAX = 64 * 1024


@router.get("/me/prefs")
def get_prefs(user=Depends(must_user), db=Depends(get_db)):
    out = {}
    for r in db.execute("SELECT key, value FROM user_prefs WHERE user_id = ?", (user["id"],)):
        try:
            out[r["key"]] = json.loads(r["value"])
        except ValueError:
            continue
    return out


class PrefIn(BaseModel):
    value: object


@router.put("/me/prefs/{key}")
def put_pref(key: str, body: PrefIn, user=Depends(must_user), db=Depends(get_db)):
    if key not in KEYS:
        raise HTTPException(404, "Unknown setting")
    raw = json.dumps(body.value, separators=(",", ":"))
    if len(raw.encode()) > MAX:
        raise HTTPException(413, "That is too much to keep (64 KB at most)")
    if key == "snippets":
        v = body.value
        if not isinstance(v, list) or len(v) > 300 or not all(isinstance(x, dict) and isinstance(x.get("trigger"), str) and isinstance(x.get("text"), str) for x in v):
            raise HTTPException(422, "Snippets are a list of {trigger, text}")
        seen = set()
        for x in v:
            t = x["trigger"]
            if not 2 <= len(t) <= 40 or " " in t or "\n" in t:
                raise HTTPException(422, f"“{t[:20]}” can't be a trigger: 2 to 40 characters, no spaces")
            if t in seen:
                raise HTTPException(422, f"“{t}” is used twice")
            seen.add(t)
    db.execute("INSERT INTO user_prefs (user_id, key, value, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", (user["id"], key, raw, time.time()))
    db.commit()
    return {"ok": True}
