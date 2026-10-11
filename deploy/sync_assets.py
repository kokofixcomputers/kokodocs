#!/usr/bin/env python3
"""
SFTP Sync Script for KokoDocs Assets - Fast & Accurate

Syncs:
- backend/app, backend/main.py and the requirements files (plain overwrite, no scanning or deleting)
- All files from frontend/dist/assets/ (size comparison)
- Special files: frontend/dist/index.html and frontend/dist/version.js (hash comparison)

To remote: sftp://hosting.kokodev.cc:2022
"""

import os
import sys
import stat
import hashlib
import getpass
import paramiko
import time
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- ANSI Color Codes ---
class C:
    R = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RED = "\033[38;5;196m"
    GREEN = "\033[38;5;40m"
    YELLOW = "\033[38;5;226m"
    BLUE = "\033[38;5;33m"
    CYAN = "\033[38;5;51m"
    WHITE = "\033[38;5;231m"
    ORANGE = "\033[38;5;208m"
    PINK = "\033[38;5;213m"
    BG_RED = "\033[48;5;196m"

print_lock = threading.Lock()

def p(text="", color=None, end="\n", flush=True):
    with print_lock:
        if color:
            print(f"{color}{text}{C.R}", end=end, flush=flush)
        else:
            print(text, end=end, flush=flush)


class ProgressBar:
    def __init__(self, total, description="Processing"):
        self.total = total
        self.current = 0
        self.description = description
        self.width = 40
        self.start_time = time.time()
        self.lock = threading.Lock()
        self.last_print = 0
    
    def update(self, n=1):
        with self.lock:
            self.current += n
            now = time.time()
            if now - self.last_print < 0.1 and self.current < self.total:
                return
            self.last_print = now
            percent = self.current / self.total if self.total > 0 else 0
            filled = int(self.width * percent)
            bar = "█" * filled + "░" * (self.width - filled)
            elapsed = time.time() - self.start_time
            eta = elapsed / self.current * (self.total - self.current) if self.current > 0 and self.total > 0 else 0
            eta_str = f"{eta:.1f}s" if eta < 60 else f"{eta/60:.1f}m"
            sys.stdout.write(f"\r{C.CYAN}{self.description}{C.R}: [{bar}] {self.current}/{self.total} ({percent*100:.1f}%) {eta_str}    ")
            sys.stdout.flush()
    
    def finish(self):
        with self.lock:
            elapsed = time.time() - self.start_time
            sys.stdout.write(f"\r{C.CYAN}{self.description}{C.R}: [{'█' * self.width}] {self.total}/{self.total} (100%) {elapsed:.1f}s{C.R}\n")
            sys.stdout.flush()


# --- Configuration ---
HOST = "hosting.kokodev.cc"
PORT = 2022
USERNAME = "kokofixcomputers.abcd87d4"
REMOTE_ASSETS = "frontend/dist/assets"   # Remote assets directory
REMOTE_SPECIAL_DIR = "frontend/dist"      # Remote directory for special files
LOCAL_ASSETS = "/Users/ct/Documents/kokodocs/frontend/dist/assets"
LOCAL_SPECIAL_DIR = "/Users/ct/Documents/kokodocs/frontend/dist"
LOCAL_BACKEND = "/Users/ct/Documents/kokodocs/backend"
REMOTE_BACKEND = "backend"
BACKEND_FILES = ["main.py", "requirements.txt", "requirements-local.txt"]   # plus everything under backend/app
BACKEND_SKIP_DIRS = {"__pycache__"}
SPECIAL_FILES = {"index.html", "version.js"}
HASH_ALGORITHM = "sha256"
MAX_THREADS = 10


def normalize_path(path):
    return path.replace("\\", "/")


class SFTPConnectionPool:
    def __init__(self, password, max_connections=MAX_THREADS):
        self.password = password
        self.max_connections = max_connections
        self._connections = []
        self._lock = threading.Lock()
    
    def get_connection(self):
        with self._lock:
            if self._connections:
                return self._connections.pop()
            transport = paramiko.Transport((HOST, PORT))
            transport.connect(username=USERNAME, password=self.password)
            return paramiko.SFTPClient.from_transport(transport)
    
    def return_connection(self, sftp):
        with self._lock:
            if len(self._connections) < self.max_connections:
                self._connections.append(sftp)
            else:
                try:
                    sftp.close()
                except:
                    pass
    
    def close_all(self):
        with self._lock:
            for sftp in self._connections:
                try:
                    sftp.close()
                except:
                    pass
            self._connections = []


def compute_file_hash(filepath, algorithm=HASH_ALGORITHM):
    if not os.path.isfile(filepath):
        return None
    h = hashlib.new(algorithm)
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def sftp_walk(sftp, remote_dir):
    """Recursively walk SFTP directory."""
    remote_dir = normalize_path(remote_dir)
    try:
        entries = sftp.listdir_attr(remote_dir)
    except Exception:
        return
    
    dirs = []
    files = []
    for entry in entries:
        filename = entry.filename
        if filename in ('.', '..'):
            continue
        try:
            full_path = normalize_path(os.path.join(remote_dir, filename))
            attrs = sftp.stat(full_path)
            if attrs.st_mode & stat.S_IFDIR:
                dirs.append(filename)
            else:
                files.append((filename, attrs.st_size))
        except:
            files.append((filename, 0))
    
    yield remote_dir, dirs, files
    for d in dirs:
        subdir = normalize_path(os.path.join(remote_dir, d))
        for result in sftp_walk(sftp, subdir):
            yield result


def list_remote_files(sftp, remote_dir):
    """List remote files with sizes."""
    files = {}
    remote_dir = normalize_path(remote_dir)
    for root, dirs, file_list in sftp_walk(sftp, remote_dir):
        for filename, size in file_list:
            full_path = normalize_path(os.path.join(root, filename))
            rel_path = normalize_path(os.path.relpath(full_path, remote_dir))
            if rel_path == ".":
                continue
            files[rel_path] = {'path': full_path, 'size': size}
    return files


def list_local_files(local_dir):
    """List local files with sizes and hashes (parallel)."""
    files = {}
    local_dir = Path(local_dir)
    if not local_dir.exists():
        return files
    
    file_infos = []
    for file_path in local_dir.rglob("*"):
        if file_path.is_file():
            rel_path = file_path.relative_to(local_dir).as_posix()
            file_infos.append((rel_path, str(file_path), file_path.stat().st_size))
    
    with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
        futures = {executor.submit(compute_file_hash, fp): (rp, fp, size) 
                   for rp, fp, size in file_infos}
        for future in as_completed(futures):
            rp, fp, size = futures[future]
            files[rp] = {'path': fp, 'size': size, 'hash': future.result()}
    return files


def get_remote_hash(sftp, remote_path, algorithm=HASH_ALGORITHM):
    """Get hash of remote file."""
    h = hashlib.new(algorithm)
    try:
        with sftp.open(remote_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


def create_remote_dirs(sftp, remote_path):
    """Create all parent directories for a remote path."""
    remote_path = normalize_path(remote_path)
    remote_dir = normalize_path(os.path.dirname(remote_path))
    if not remote_dir:
        return
    parts = [p for p in remote_dir.split("/") if p]
    current = ""
    for part in parts:
        current = os.path.join(current, part) if current else part
        current = normalize_path(current)
        try:
            sftp.stat(current)
        except:
            try:
                sftp.mkdir(current)
            except:
                pass


def upload_file(pool, local_path, remote_path, pb):
    """Upload a single file."""
    sftp = pool.get_connection()
    try:
        create_remote_dirs(sftp, remote_path)
        sftp.put(local_path, remote_path)
        return True, None
    except Exception as e:
        return False, str(e)
    finally:
        pool.return_connection(sftp)


def delete_file(pool, remote_path, pb):
    """Delete a single file."""
    sftp = pool.get_connection()
    try:
        sftp.remove(remote_path)
        return True, None
    except Exception as e:
        return False, str(e)
    finally:
        pool.return_connection(sftp)


def backend_files():
    """(local path, remote path) for everything in the backend that gets overwritten."""
    out = []
    base = Path(LOCAL_BACKEND)
    for name in BACKEND_FILES:
        if (base / name).is_file():
            out.append((str(base / name), f"{REMOTE_BACKEND}/{name}"))
    for f in (base / "app").rglob("*"):
        if f.is_file() and not (set(f.relative_to(base).parts) & BACKEND_SKIP_DIRS) and f.suffix != ".pyc":
            out.append((str(f), f"{REMOTE_BACKEND}/{f.relative_to(base).as_posix()}"))
    return out


def sync_backend(pool):
    """Overwrite the backend on the server with the local one."""
    files = backend_files()
    p(f"{C.CYAN}Uploading backend ({len(files)} files, overwriting)...{C.R}")
    pb = ProgressBar(len(files), "Backend")
    failed = []
    with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
        fs = {executor.submit(upload_file, pool, lp, rp, pb): rp for lp, rp in files}
        for future in as_completed(fs):
            ok, err = future.result()
            if not ok:
                failed.append((fs[future], err))
            pb.update(1)
    pb.finish()
    for rp, err in failed:
        p(f"  {C.RED}failed{C.R} {rp}: {err}")
    return len(files) - len(failed)


def sync_assets():
    p(f"\n{C.BOLD + C.CYAN}KokoDocs Asset Sync{C.R}\n")
    
    password = getpass.getpass(f"{C.YELLOW}Enter SFTP password for {C.CYAN}{USERNAME}@{HOST}{C.YELLOW}: {C.R}")
    
    transport = paramiko.Transport((HOST, PORT))
    transport.connect(username=USERNAME, password=password)
    main_sftp = paramiko.SFTPClient.from_transport(transport)
    
    pool = SFTPConnectionPool(password, max_connections=MAX_THREADS)
    
    try:
        p(f"{C.CYAN}Scanning remote...{C.R}")
        
        # Scan remote assets
        remote_assets = list_remote_files(main_sftp, REMOTE_ASSETS)
        p(f"  Found {C.GREEN}{len(remote_assets)}{C.R} remote asset files")
        
        # Scan remote special files
        remote_special = {}
        for special in SPECIAL_FILES:
            remote_path = normalize_path(os.path.join(REMOTE_SPECIAL_DIR, special))
            try:
                attrs = main_sftp.stat(remote_path)
                remote_special[special] = {'path': remote_path, 'size': attrs.st_size}
            except:
                pass
        p(f"  Found {C.GREEN}{len(remote_special)}{C.R} remote special files")

        p(f"{C.CYAN}Scanning local...{C.R}")
        
        # Scan local assets
        local_assets = list_local_files(LOCAL_ASSETS)
        p(f"  Found {C.GREEN}{len(local_assets)}{C.R} local asset files")
        
        # Scan local special files
        local_special = {}
        for special in SPECIAL_FILES:
            local_path = os.path.join(LOCAL_SPECIAL_DIR, special)
            if os.path.isfile(local_path):
                size = os.path.getsize(local_path)
                file_hash = compute_file_hash(local_path)
                local_special[special] = {'path': local_path, 'size': size, 'hash': file_hash}
        p(f"  Found {C.GREEN}{len(local_special)}{C.R} local special files")

        # Compare asset files (size only - fast)
        p(f"{C.CYAN}Comparing...{C.R}")
        identical_count = 0
        files_to_upload = []
        
        for rel_path, local_info in local_assets.items():
            if rel_path in remote_assets:
                remote_info = remote_assets[rel_path]
                if local_info['size'] == remote_info['size']:
                    identical_count += 1
                    continue
                files_to_upload.append((rel_path, local_info['path'], remote_info['path'], "CHANGED"))
            else:
                full_remote = normalize_path(os.path.join(REMOTE_ASSETS, rel_path))
                files_to_upload.append((rel_path, local_info['path'], full_remote, "NEW"))
        
        # Compare special files (hash verification)
        for special, local_info in local_special.items():
            if special in remote_special:
                remote_info = remote_special[special]
                remote_hash = get_remote_hash(main_sftp, remote_info['path'])
                if local_info['hash'] == remote_hash:
                    identical_count += 1
                    continue
                files_to_upload.append((special, local_info['path'], remote_info['path'], "CHANGED"))
            else:
                full_remote = normalize_path(os.path.join(REMOTE_SPECIAL_DIR, special))
                files_to_upload.append((special, local_info['path'], full_remote, "NEW"))
        
        # Check for special files to delete
        files_to_delete = []
        for special, remote_info in remote_special.items():
            if special not in local_special:
                files_to_delete.append((special, remote_info['path']))
        
        p(f"  Identical: {C.GREEN}{identical_count}{C.R}")
        p(f"  To upload: {C.GREEN}{len(files_to_upload)}{C.R}")
        p(f"  To delete: {C.RED}{len(files_to_delete)}{C.R}")

        # Upload files in parallel
        if files_to_upload:
            p()
            p(f"{C.CYAN}Uploading files...{C.R}")
            pb = ProgressBar(len(files_to_upload), "Uploading")
            
            with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
                # each entry is (relative name, local path, remote path, label): upload to the remote path, not the relative name
                fs = {executor.submit(upload_file, pool, lp, remote, pb): rel
                      for rel, lp, remote, _ in files_to_upload}
                for future in as_completed(fs):
                    pb.update(1)
            pb.finish()
        
        # Delete files in parallel
        if files_to_delete:
            p()
            p(f"{C.CYAN}Deleting files...{C.R}")
            pb = ProgressBar(len(files_to_delete), "Deleting")
            
            with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
                fs = {executor.submit(delete_file, pool, rp, pb): rp 
                      for rp, _ in files_to_delete}
                for future in as_completed(fs):
                    pb.update(1)
            pb.finish()
        
        backend_done = sync_backend(pool)

        # Clean up empty directories
        p(f"{C.CYAN}Cleaning up...{C.R}")
        cleanup_count = 0
        all_dirs = set()
        for root, dirs, _ in sftp_walk(main_sftp, REMOTE_ASSETS):
            for d in dirs:
                all_dirs.add(normalize_path(os.path.join(root, d)))
        
        sorted_dirs = sorted(all_dirs, key=lambda x: x.count("/"), reverse=True)
        for remote_dir in sorted_dirs:
            if remote_dir == normalize_path(REMOTE_ASSETS):
                continue
            try:
                if len(list(main_sftp.listdir(remote_dir))) == 0:
                    main_sftp.rmdir(remote_dir)
                    cleanup_count += 1
            except Exception:
                pass
        
        p(f"  Cleaned: {C.PINK}{cleanup_count}{C.R} empty directories")
        p()
        p(f"{C.BOLD + C.GREEN}done{C.R}")
        p(f"  Backend files: {C.GREEN}{backend_done}{C.R}")
        p(f"  Uploaded: {C.GREEN}{len(files_to_upload)}{C.R} | Deleted: {C.RED}{len(files_to_delete)}{C.R} | Cleaned: {C.PINK}{cleanup_count}{C.R}")

    except Exception as e:
        p(f"\n{C.BG_RED}{C.WHITE} ERROR {C.R}: {e}", C.RED)
        import traceback
        traceback.print_exc()
    finally:
        pool.close_all()
        try:
            main_sftp.close()
        except:
            pass
        try:
            transport.close()
        except:
            pass


if __name__ == "__main__":
    if not os.path.exists(LOCAL_ASSETS):
        p(f"\n{C.BG_RED}{C.WHITE} ERROR {C.R}: Local directory not found: {LOCAL_ASSETS}", C.RED)
        sys.exit(1)

    try:
        import paramiko
    except ImportError:
        p(f"\n{C.BG_RED}{C.WHITE} ERROR {C.R}: paramiko is not installed.", C.RED)
        p(f"  Please run: {C.YELLOW}pip install paramiko{C.R}")
        sys.exit(1)

    sync_assets()
