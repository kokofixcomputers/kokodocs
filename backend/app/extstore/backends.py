"""Where the bytes go: a mounted folder, a WebDAV server, or any S3-compatible bucket. Plain HTTP with httpx, no extra libraries."""
import datetime as dt
import hashlib
import hmac
import ipaddress
import os
import re
import socket
from pathlib import Path
from urllib.parse import quote, urlparse

import httpx

MAX_OBJECT = 512 * 1024 * 1024
TIMEOUT = httpx.Timeout(60.0, connect=10.0)


class StorageError(Exception):
    """Something a person can act on: wrong password, unreachable, no such bucket. The message is shown to them."""


def allow_private() -> bool:
    return os.environ.get("KOKO_STORAGE_ALLOW_PRIVATE", "").lower() in {"1", "true", "yes"}


def folder_root() -> Path | None:
    """The folder on this server that people may use for storage (set by whoever runs the server); none means folders are not offered."""
    r = os.environ.get("KOKO_STORAGE_FOLDER_ROOT", "").strip()
    return Path(r).resolve() if r else None


def check_url(url: str) -> str:
    """The address has to be a web address on the public internet (a server on a private network is refused unless whoever runs this server allows it)."""
    u = urlparse(url.strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise StorageError("Enter a full web address such as https://cloud.example.com/remote.php/dav/files/me/")
    if u.username or u.password:
        raise StorageError("Don't put a name or password in the address; use the fields below it")
    if not allow_private():
        if u.scheme != "https":
            raise StorageError("The address must start with https:// (a server on a private network needs KOKO_STORAGE_ALLOW_PRIVATE=1 on this server)")
        try:
            infos = socket.getaddrinfo(u.hostname, u.port or 443, type=socket.SOCK_STREAM)
        except socket.gaierror:
            raise StorageError(f"Could not find {u.hostname}")
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if not ip.is_global or ip.is_multicast:
                raise StorageError("That address is on a private network and isn't allowed (whoever runs this server can allow it with KOKO_STORAGE_ALLOW_PRIVATE=1)")
    return url.strip().rstrip("/")


def clean_key(key: str) -> str:
    parts = [p for p in key.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):
        raise StorageError("That path is not allowed")
    return "/".join(parts)


class Backend:
    kind = ""

    def put(self, key: str, data: bytes) -> None: raise NotImplementedError
    def get(self, key: str) -> bytes | None: raise NotImplementedError
    def delete(self, key: str) -> None: raise NotImplementedError
    def size(self, key: str) -> int | None: raise NotImplementedError

    def test(self) -> str:
        """Write, read back and remove a small file: proves the connection works and says what it is."""
        probe = f"_koko-test-{os.urandom(4).hex()}"
        body = b"KokoDocs storage test " + os.urandom(8)
        self.put(probe, body)
        try:
            if self.get(probe) != body:
                raise StorageError("The storage accepted a file but gave back something different")
        finally:
            try:
                self.delete(probe)
            except StorageError:
                pass
        return "Connected: a test file was written, read back and removed."


class FolderBackend(Backend):
    kind = "folder"

    def __init__(self, path: str):
        root = folder_root()
        if not root:
            raise StorageError("Folders are not available on this server")
        rel = clean_key(path or "")
        self.dir = (root / rel).resolve()
        if root != self.dir and root not in self.dir.parents:
            raise StorageError("That folder is outside the one this server allows")

    def _p(self, key: str) -> Path:
        p = (self.dir / clean_key(key)).resolve()
        if self.dir != p and self.dir not in p.parents:
            raise StorageError("That path is not allowed")
        return p

    def put(self, key, data):
        try:
            p = self._p(key); p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_name(p.name + ".part"); tmp.write_bytes(data); tmp.replace(p)
        except OSError as e:
            raise StorageError(f"Could not write to the folder ({e.strerror or e})")

    def get(self, key):
        try:
            return self._p(key).read_bytes()
        except FileNotFoundError:
            return None
        except OSError as e:
            raise StorageError(f"Could not read from the folder ({e.strerror or e})")

    def delete(self, key):
        try:
            self._p(key).unlink(missing_ok=True)
        except OSError as e:
            raise StorageError(f"Could not delete from the folder ({e.strerror or e})")

    def size(self, key):
        try:
            return self._p(key).stat().st_size
        except FileNotFoundError:
            return None


def _explain(r: httpx.Response, what: str) -> StorageError:
    if r.status_code in (401, 403):
        return StorageError(f"The storage refused {what}: check the name and password (or key) and that it may write there ({r.status_code})")
    if r.status_code == 404:
        return StorageError(f"The storage could not find the place to {what}: check the address (404)")
    if r.status_code == 507:
        return StorageError("The storage is full (507)")
    return StorageError(f"The storage could not {what} ({r.status_code})")


class WebDavBackend(Backend):
    kind = "webdav"

    def __init__(self, url: str, username: str, password: str, prefix: str = ""):
        self.base = check_url(url)
        self.auth = (username, password) if username else None
        self.prefix = clean_key(prefix)

    def _url(self, key: str) -> str:
        path = "/".join(p for p in (self.prefix, clean_key(key)) if p)
        return self.base + "/" + "/".join(quote(s, safe="") for s in path.split("/") if s)

    def _client(self) -> httpx.Client:
        return httpx.Client(auth=self.auth, timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": "KokoDocs-storage/1.0"})

    def _mkcols(self, c: httpx.Client, key: str) -> None:
        """WebDAV won't create folders on the way: make each one (it is fine if it exists)."""
        parts = [p for p in (self.prefix + "/" + clean_key(key)).split("/") if p][:-1]
        cur = self.base
        for p in parts:
            cur += "/" + quote(p, safe="")
            try:
                r = c.request("MKCOL", cur)
            except httpx.HTTPError as e:
                raise StorageError(f"Could not reach the storage ({type(e).__name__})")
            if r.status_code in (401, 403) and r.status_code != 405:
                raise _explain(r, "create the folder")

    def put(self, key, data):
        if len(data) > MAX_OBJECT:
            raise StorageError("That file is too large to store")
        try:
            with self._client() as c:
                r = c.put(self._url(key), content=data)
                if r.status_code in (404, 409):   # the folder is not there yet
                    self._mkcols(c, key)
                    r = c.put(self._url(key), content=data)
        except httpx.HTTPError as e:
            raise StorageError(f"Could not reach the storage ({type(e).__name__})")
        if r.status_code not in (200, 201, 204):
            raise _explain(r, "save a file")

    def get(self, key):
        try:
            with self._client() as c:
                r = c.get(self._url(key))
        except httpx.HTTPError as e:
            raise StorageError(f"Could not reach the storage ({type(e).__name__})")
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise _explain(r, "read a file")
        return r.content

    def delete(self, key):
        try:
            with self._client() as c:
                r = c.delete(self._url(key))
        except httpx.HTTPError as e:
            raise StorageError(f"Could not reach the storage ({type(e).__name__})")
        if r.status_code not in (200, 202, 204, 404):
            raise _explain(r, "delete a file")

    def size(self, key):
        try:
            with self._client() as c:
                r = c.head(self._url(key))
                if r.status_code in (405, 501):
                    r = c.get(self._url(key))
        except httpx.HTTPError as e:
            raise StorageError(f"Could not reach the storage ({type(e).__name__})")
        if r.status_code == 404:
            return None
        if r.status_code not in (200, 204):
            raise _explain(r, "check a file")
        n = r.headers.get("content-length")
        return int(n) if n is not None else len(r.content)


def sigv4_headers(method: str, url: str, region: str, access: str, secret: str, payload_hash: str, now: dt.datetime | None = None, extra: dict | None = None) -> dict:
    """AWS Signature Version 4 for one S3 request (path-style address)."""
    now = now or dt.datetime.now(dt.timezone.utc)
    amz, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    u = urlparse(url)
    host = u.netloc
    headers = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz, **{k.lower(): v for k, v in (extra or {}).items()}}
    signed = ";".join(sorted(headers))
    canon_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in sorted(headers))
    query = "&".join(sorted(f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}" for k, _, v in (p.partition("=") for p in u.query.split("&") if p)))
    canonical = "\n".join([method, u.path or "/", query, canon_headers, signed, payload_hash])
    scope = f"{day}/{region}/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    k = hmac.new(("AWS4" + secret).encode(), day.encode(), hashlib.sha256).digest()
    for part in (region, "s3", "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    out = {k2: v for k2, v in headers.items() if k2 != "host"}
    out["Authorization"] = f"AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={signed}, Signature={sig}"
    return out


class S3Backend(Backend):
    kind = "s3"

    def __init__(self, endpoint: str, region: str, bucket: str, access_key: str, secret_key: str, prefix: str = ""):
        self.endpoint = check_url(endpoint)
        self.region = (region or "us-east-1").strip()
        self.bucket = bucket.strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{1,62}", self.bucket):
            raise StorageError("That is not a valid bucket name")
        self.access, self.secret = access_key.strip(), secret_key.strip()
        if not self.access or not self.secret:
            raise StorageError("Enter the access key and the secret key")
        self.prefix = clean_key(prefix)

    def _url(self, key: str) -> str:
        path = "/".join(p for p in (self.prefix, clean_key(key)) if p)
        return f"{self.endpoint}/{quote(self.bucket, safe='')}/" + "/".join(quote(s, safe="-_.~") for s in path.split("/") if s)

    def _do(self, method: str, key: str, body: bytes = b"") -> httpx.Response:
        url = self._url(key)
        h = sigv4_headers(method, url, self.region, self.access, self.secret, hashlib.sha256(body).hexdigest())
        try:
            with httpx.Client(timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": "KokoDocs-storage/1.0"}) as c:
                return c.request(method, url, headers=h, content=body if method == "PUT" else None)
        except httpx.HTTPError as e:
            raise StorageError(f"Could not reach the storage ({type(e).__name__})")

    def put(self, key, data):
        if len(data) > MAX_OBJECT:
            raise StorageError("That file is too large to store")
        r = self._do("PUT", key, data)
        if r.status_code not in (200, 201, 204):
            raise _explain(r, "save a file")

    def get(self, key):
        r = self._do("GET", key)
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise _explain(r, "read a file")
        return r.content

    def delete(self, key):
        r = self._do("DELETE", key)
        if r.status_code not in (200, 202, 204, 404):
            raise _explain(r, "delete a file")

    def size(self, key):
        r = self._do("HEAD", key)
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise _explain(r, "check a file")
        return int(r.headers.get("content-length", "0"))


KINDS = ("s3", "webdav", "folder")


def make(kind: str, cfg: dict) -> Backend:
    """A backend from a saved connection (its settings as stored)."""
    g = lambda k: str(cfg.get(k, "") or "")
    if kind == "s3":
        return S3Backend(g("endpoint"), g("region"), g("bucket"), g("access_key"), g("secret_key"), g("prefix") or "kokodocs")
    if kind == "webdav":
        return WebDavBackend(g("url"), g("username"), g("password"), g("prefix") or "kokodocs")
    if kind == "folder":
        return FolderBackend(g("path"))
    raise StorageError("Unknown kind of storage")
