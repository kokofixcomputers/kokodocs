"""Tags API: label files and folders, see every tag you use, rename or remove one everywhere."""
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import access, tagdb
from .db import get_db
from .routes import ctx, must_user

router = APIRouter(prefix="/api")


@router.get("/tags")
def my_tags(user=Depends(must_user), db=Depends(get_db)):
    """Every tag you have used, with how many files and folders carry it."""
    counts: dict[str, list] = {}
    for kind, (table, col) in tagdb.TABLES.items():
        for r in db.execute(f"SELECT tag, COUNT(*) AS n FROM {table} WHERE user_id = ? GROUP BY tag", (user["id"],)):
            e = counts.setdefault(r["tag"].lower(), [r["tag"], 0])
            e[1] += r["n"]
    return {"tags": sorted(({"name": n, "count": c} for n, c in counts.values()), key=lambda t: t["name"].lower())}


class TagsIn(BaseModel):
    tags: list[str] = Field(max_length=50)


@router.put("/tags/{kind}/{item_id}")
def set_tags(kind: Literal["doc", "folder"], item_id: str, body: TagsIn, c=Depends(ctx), user=Depends(must_user), db=Depends(get_db)):
    """Replace the tags you have put on one file or folder."""
    if kind == "doc":
        access.require(db, item_id, *c)   # you can tag anything you can open
    else:
        f = db.execute("SELECT id FROM folders WHERE id = ? AND owner_id = ?", (item_id, user["id"])).fetchone()
        if not f:
            raise HTTPException(404, "Folder not found")
    table, col = tagdb.TABLES[kind]
    tags = tagdb.clean(body.tags)
    db.execute(f"DELETE FROM {table} WHERE user_id = ? AND {col} = ?", (user["id"], item_id))
    now = time.time()
    db.executemany(f"INSERT OR IGNORE INTO {table} (user_id, {col}, tag, created_at) VALUES (?,?,?,?)", [(user["id"], item_id, t, now) for t in tags])
    db.commit()
    return {"tags": tags}


class RenameIn(BaseModel):
    old: str = Field(min_length=1, max_length=60)
    new: str = Field(min_length=1, max_length=60)


@router.post("/tags/rename")
def rename_tag(body: RenameIn, user=Depends(must_user), db=Depends(get_db)):
    """Rename a tag everywhere you use it. Renaming onto an existing tag merges the two."""
    new = (tagdb.clean([body.new]) or [None])[0]
    if not new:
        raise HTTPException(422, "Enter a name for the tag")
    for table, col in tagdb.TABLES.values():
        db.execute(f"INSERT OR IGNORE INTO {table} (user_id, {col}, tag, created_at) SELECT user_id, {col}, ?, created_at FROM {table} WHERE user_id = ? AND tag = ?", (new, user["id"], body.old))
        if new.lower() != body.old.lower():
            db.execute(f"DELETE FROM {table} WHERE user_id = ? AND tag = ?", (user["id"], body.old))
        else:   # only the capitalisation changes: keep the new spelling
            db.execute(f"UPDATE {table} SET tag = ? WHERE user_id = ? AND tag = ?", (new, user["id"], body.old))
    db.commit()
    return {"ok": True, "name": new}


class DeleteIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)


@router.post("/tags/delete")
def delete_tag(body: DeleteIn, user=Depends(must_user), db=Depends(get_db)):
    """Take a tag off everything. The files and folders themselves are untouched."""
    for table, _ in tagdb.TABLES.values():
        db.execute(f"DELETE FROM {table} WHERE user_id = ? AND tag = ?", (user["id"], body.name))
    db.commit()
    return {"ok": True}
