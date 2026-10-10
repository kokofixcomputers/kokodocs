"""The `.kokodocs` file: one document with everything that belongs to it, in a single file you can keep anywhere.

It is a ZIP archive (open it with any unzip tool) holding, in this order:
  mimetype             application/x-kokodocs  (first and uncompressed, so programs can recognise the file)
  manifest.json        what it is: the format version, the document's id, title and kind, when it was saved, and a fingerprint of every other member
  state.ydoc           the document itself (a Yjs update: text, cells, slides, shapes…)
  tables/<name>.json   rows that belong to it: versions, comments, assistant conversations, form answers and the list of form attachments
  tables/<name>/<id>.<column>   the binary columns of those rows (a version's snapshot, for example)
  uploads.json         the pictures it uses (name, size, fingerprint)
  files/uploads/<name> and files/form/<stored>   the pictures and attachments themselves, only when the file is saved to take away (not when it is kept in extended storage, where they are stored beside it)
"""
import hashlib
import io
import json
import time
import uuid
import zipfile

FORMAT = "kokodocs"
VERSION = 1
MIME = "application/x-kokodocs"
# table -> the column that points at the document
TABLES = {"versions": "doc_id", "comments": "doc_id", "ai_conversations": "doc_id", "form_responses": "form_id", "form_files": "form_id"}
MAX_UNPACKED = 1024 * 1024 * 1024


class ContainerError(Exception):
    pass


def _cols(db, table: str) -> list[str]:
    return [r["name"] for r in db.execute(f"PRAGMA table_info({table})")]


def fingerprint(db, doc_id: str) -> str:
    """Cheap and stable: changes whenever anything that belongs to the document changes."""
    row = db.execute("SELECT ydoc, title, updated_at FROM documents WHERE id = ?", (doc_id,)).fetchone()
    h = hashlib.sha256()
    h.update(bytes(row["ydoc"] or b"")); h.update((row["title"] or "").encode())
    for table, col in TABLES.items():
        cols = set(_cols(db, table))
        stamp = "updated_at" if "updated_at" in cols else "created_at"
        r = db.execute(f"SELECT COUNT(*) AS n, COALESCE(MAX({stamp}), 0) AS m, COALESCE(SUM(LENGTH(id)), 0) AS l FROM {table} WHERE {col} = ?", (doc_id,)).fetchone()
        h.update(f"|{table}:{r['n']}:{r['m']}:{r['l']}".encode())
        if table == "form_files":
            h.update(str(db.execute("SELECT COUNT(*) FROM form_files WHERE form_id = ? AND response_id IS NOT NULL", (doc_id,)).fetchone()[0]).encode())
    return h.hexdigest()


def pack(db, doc_id: str, *, files=None) -> bytes:
    """The document as a `.kokodocs` file. `files(kind, name)` returns the bytes of a picture or attachment, to put them inside (omit it to leave them out)."""
    doc = db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,)).fetchone()
    if not doc:
        raise ContainerError("There is no such document")
    out = io.BytesIO()
    sums: dict[str, str] = {}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr(zipfile.ZipInfo("mimetype"), MIME, compress_type=zipfile.ZIP_STORED)

        def add(name: str, data: bytes) -> None:
            z.writestr(name, data); sums[name] = hashlib.sha256(data).hexdigest()
        add("state.ydoc", bytes(doc["ydoc"] or b""))
        for table, col in TABLES.items():
            rows = []
            for r in db.execute(f"SELECT * FROM {table} WHERE {col} = ? ORDER BY rowid", (doc_id,)):
                row = {}
                for k in r.keys():
                    v = r[k]
                    if isinstance(v, (bytes, bytearray, memoryview)):
                        member = f"tables/{table}/{r['id']}.{k}"
                        add(member, bytes(v)); row[k] = {"$blob": member}
                    else:
                        row[k] = v
                rows.append(row)
            add(f"tables/{table}.json", json.dumps(rows, separators=(",", ":")).encode())
        ups = [dict(r) for r in db.execute("SELECT u.name, u.size, u.hash, u.created_at FROM uploads u JOIN upload_refs f ON f.name = u.name WHERE f.doc_id = ?", (doc_id,))]
        add("uploads.json", json.dumps(ups, separators=(",", ":")).encode())
        if files:
            for u in ups:
                data = files("uploads", u["name"])
                if data is not None:
                    add(f"files/uploads/{u['name']}", data)
            for f in db.execute("SELECT stored FROM form_files WHERE form_id = ?", (doc_id,)):
                data = files("form", f["stored"])
                if data is not None:
                    add(f"files/form/{f['stored']}", data)
        manifest = {"format": FORMAT, "version": VERSION, "saved_at": time.time(), "doc": {"id": doc["id"], "title": doc["title"], "kind": doc["kind"], "created_at": doc["created_at"], "updated_at": doc["updated_at"]},
                    "members": sums, "with_files": bool(files)}
        z.writestr("manifest.json", json.dumps(manifest, indent=1))
    return out.getvalue()


def read(data: bytes) -> tuple[dict, zipfile.ZipFile]:
    """Open and check a `.kokodocs` file: its type, version and that nothing inside has been damaged."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ContainerError("That is not a KokoDocs file")
    names = z.namelist()
    if "manifest.json" not in names or "mimetype" not in names or z.read("mimetype") != MIME.encode():
        raise ContainerError("That is not a KokoDocs file")
    if sum(i.file_size for i in z.infolist()) > MAX_UNPACKED:
        raise ContainerError("That file is too large")
    try:
        m = json.loads(z.read("manifest.json"))
    except ValueError:
        raise ContainerError("That KokoDocs file is damaged")
    if m.get("format") != FORMAT or not isinstance(m.get("doc"), dict):
        raise ContainerError("That is not a KokoDocs file")
    if int(m.get("version", 0)) > VERSION:
        raise ContainerError("That file was made by a newer KokoDocs. Update this server to open it.")
    for name, want in (m.get("members") or {}).items():
        if name not in names or hashlib.sha256(z.read(name)).hexdigest() != want:
            raise ContainerError("That KokoDocs file is damaged (a part of it does not match)")
    return m, z


def _blobs(z: zipfile.ZipFile, row: dict) -> dict:
    return {k: (z.read(v["$blob"]) if isinstance(v, dict) and "$blob" in v else v) for k, v in row.items()}


def restore(db, doc_id: str, z: zipfile.ZipFile) -> None:
    """Put a document's contents (state and rows) back into the database under the same ids."""
    db.execute("UPDATE documents SET ydoc = ? WHERE id = ?", (z.read("state.ydoc") or None, doc_id))
    for table, col in TABLES.items():
        have = set(_cols(db, table))
        db.execute(f"DELETE FROM {table} WHERE {col} = ?", (doc_id,))
        for row in json.loads(z.read(f"tables/{table}.json")):
            row = {k: v for k, v in _blobs(z, row).items() if k in have}
            row[col] = doc_id
            db.execute(f"INSERT OR REPLACE INTO {table} ({','.join(row)}) VALUES ({','.join('?' * len(row))})", list(row.values()))


def import_as_new(db, owner_id: str, z: zipfile.ZipFile, manifest: dict, *, folder_id: str | None, write_file) -> str:
    """Make a new document from a file (new ids everywhere, so it never clashes with the original). `write_file(kind, name, data)` stores a picture or attachment."""
    src = manifest["doc"]
    new = uuid.uuid4().hex[:16]; now = time.time()
    db.execute("INSERT INTO documents (id, owner_id, title, ydoc, folder_id, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
               (new, owner_id, (src.get("title") or "Untitled")[:200], z.read("state.ydoc") or None, folder_id, src.get("kind") if src.get("kind") in ("doc", "sheet", "slides", "form", "wiki", "board", "whiteboard") else "doc", now, now))
    ids: dict[str, str] = {}
    for table, col in TABLES.items():
        rows = json.loads(z.read(f"tables/{table}.json"))
        for r in rows:
            ids[r["id"]] = uuid.uuid4().hex[:16] if table != "versions" else uuid.uuid4().hex
    for table, col in TABLES.items():
        have = set(_cols(db, table))
        stored: dict[str, str] = {}
        for raw in json.loads(z.read(f"tables/{table}.json")):
            row = {k: v for k, v in _blobs(z, raw).items() if k in have}
            row["id"] = ids[raw["id"]]; row[col] = new
            for ref in ("parent_id", "response_id"):
                if row.get(ref):
                    row[ref] = ids.get(row[ref], None)
            if table == "form_files":
                nm = uuid.uuid4().hex; old = row.get("stored", ""); row["stored"] = nm; stored[old] = nm
            db.execute(f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join('?' * len(row))})", list(row.values()))
        if table == "form_files":
            for old, nm in stored.items():
                m = f"files/form/{old}"
                if m in z.namelist():
                    write_file("form", nm, z.read(m))
    for u in json.loads(z.read("uploads.json")):
        m = f"files/uploads/{u['name']}"
        if m in z.namelist() and u["name"].replace(".", "").isalnum():
            exists = db.execute("SELECT 1 FROM uploads WHERE name = ?", (u["name"],)).fetchone()
            if not exists:
                write_file("uploads", u["name"], z.read(m))
                db.execute("INSERT INTO uploads (name, doc_id, owner_id, size, created_at, hash) VALUES (?,?,?,?,?,?)", (u["name"], new, owner_id, u["size"], now, u.get("hash")))
            db.execute("INSERT OR IGNORE INTO upload_refs (name, doc_id) VALUES (?,?)", (u["name"], new))
    return new
