#!/usr/bin/env python3
"""
SFTP Sync Script for KokoDocs Assets - Blazing Fast Version

Syncs:
- All files from frontend/dist/assets/ (size comparison)
- Special files: frontend/dist/index.html and frontend/dist/version.js (hash comparison)

Optimizations:
- Minimal terminal output (only changes printed)
- Single connection for scanning
- Parallel hash for special files only
- Parallel uploads/deletes with connection pooling
- Size comparison for regular files
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
    MAGENTA = "\033[38;5;201m"
    CYAN = "\033[38;5;51m"
    WHITE = "\033[38;5;231m"
    ORANGE = "\033[38;5;208m"
    PINK = "\033[38;5;213m"
    PURPLE = "\033[38;5;141m"
    BG_RED = "\033[48;5;196m"

# Thread-safe print with lock
print_lock = threading.Lock()

def p(text="", color=None, end="\n", flush=True):
    """Thread-safe colored print."""
    with print_lock:
        if color:
            print(f"{color}{text}{C.R}", end=end, flush=flush)
        else:
            print(text, end=end, flush=flush)


# Progress bar (thread-safe)
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
            # Only update display every 0.1 seconds to reduce overhead
            if now - self.last_print < 0.1 and self.current < self.total:
                return
            self.last_print = now
            
            percent = self.current / self.total if self.total > 0 else 0
            filled = int(self.width * percent)
            bar = "█" * filled + "░" * (self.width - filled)
            elapsed = time.time() - self.start_time
            if self.current > 0 and self.total > 0:
                eta = elapsed / self.current * (self.total - self.current)
                eta_str = f"{eta:.1f}s" if eta < 60 else f"{eta/60:.1f}m"
            else:
                eta_str = "?"
            
            sys.stdout.write(f"\r{C.CYAN}{self.description}{C.R}: [{bar}] {self.current}/{self.total} " +
                           f"({percent*100:.1f}%) {eta_str}    ")
            sys.stdout.flush()
    
    def finish(self):
        with self.lock:
            elapsed = time.time() - self.start_time
            sys.stdout.write(f"\r{C.CYAN}{self.description}{C.R}: [{'█' * self.width}] {self.total}/{self.total} " +
                           f"(100%) {elapsed:.1f}s{C.R}\n")
            sys.stdout.flush()


# --- Configuration ---
HOST = "hosting.kokodev.cc"
PORT = 2022
USERNAME = "kokofixcomputers.abcd87d4"
REMOTE_BASE = "frontend/dist/assets"
LOCAL_BASE = "/Users/ct/Documents/kokodocs/frontend/dist/assets"
REMOTE_ROOT = "frontend/dist"
LOCAL_ROOT = "/Users/ct/Documents/kokodocs/frontend/dist"
SPECIAL_FILES = {"index.html", "version.js"}
HASH_ALGORITHM = "sha256"
MAX_THREADS = 10


def normalize_path(path):
    """Normalize path to use forward slashes."""
    return path.replace("\\", "/")


# Connection pool
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
    """Compute hash of a local file."""
    if not os.path.isfile(filepath):
        return None
    h = hashlib.new(algorithm)
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def get_remote_file_hash(sftp, remote_path, algorithm=HASH_ALGORITHM):
    """Compute hash of a remote file via SFTP."""
    h = hashlib.new(algorithm)
    try:
        with sftp.open(remote_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


def sftp_walk(sftp, remote_dir):
    """Recursively walk through SFTP directory."""
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


def list_files_with_size(sftp, remote_dir):
    """List files with their sizes."""
    files = {}
    remote_dir = normalize_path(remote_dir)
    
    for root, dirs, file_list in sftp_walk(sftp, remote_dir):
        for filename, size in file_list:
            remote_path = normalize_path(os.path.join(root, filename))
            relative_path = normalize_path(os.path.relpath(remote_path, remote_dir))
            if relative_path == ".":
                continue
            files[relative_path] = {'path': remote_path, 'size': size}
    
    return files


def list_local_files_with_size(local_dir):
    """List local files with sizes and hashes (parallel hash for special files only)."""
    files = {}
    local_dir = Path(local_dir)
    if not local_dir.exists():
        return files
    
    # Get all file paths and sizes
    file_infos = []
    for file_path in local_dir.rglob("*"):
        if file_path.is_file():
            relative_path = file_path.relative_to(local_dir).as_posix()
            file_infos.append((relative_path, str(file_path), file_path.stat().st_size))
    
    # Compute hashes in parallel (for all files, but special files will use them)
    with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
        futures = {executor.submit(compute_file_hash, fp): (rp, fp, size) 
                   for rp, fp, size in file_infos}
        
        for future in as_completed(futures):
            rp, fp, size = futures[future]
            file_hash = future.result()
            files[rp] = {'path': fp, 'size': size, 'hash': file_hash}
    
    return files


def upload_file(pool, local_path, remote_path, pb):
    """Upload a single file."""
    sftp = pool.get_connection()
    try:
        remote_dir = normalize_path(os.path.dirname(remote_path))
        try:
            sftp.stat(remote_dir)
        except:
            sftp.mkdir(remote_dir)
        
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


def sync_assets():
    """Main sync function."""
    p(f"\n{C.BOLD + C.CYAN}KokoDocs Asset Sync{C.R}\n")
    
    password = getpass.getpass(f"{C.YELLOW}Enter SFTP password for {C.CYAN}{USERNAME}@{HOST}{C.YELLOW}: {C.R}")
    
    # Single connection for scanning
    transport = paramiko.Transport((HOST, PORT))
    transport.connect(username=USERNAME, password=password)
    main_sftp = paramiko.SFTPClient.from_transport(transport)
    
    # Connection pool for parallel operations
    pool = SFTPConnectionPool(password, max_connections=MAX_THREADS)
    
    try:
        p(f"{C.CYAN}Scanning...{C.R}")

        # Step 1: Scan remote files (assets directory)
        remote_assets = list_files_with_size(main_sftp, REMOTE_BASE)
        
        # Also scan special files at root
        remote_special = {}
        for special in SPECIAL_FILES:
            remote_path = normalize_path(os.path.join(REMOTE_ROOT, special))
            try:
                attrs = main_sftp.stat(remote_path)
                remote_special[special] = {'path': remote_path, 'size': attrs.st_size}
            except:
                pass  # File doesn't exist on remote
        
        p(f"  Remote: {C.GREEN}{len(remote_assets)}{C.R} asset files, {C.GREEN}{len(remote_special)}{C.R} special files")

        # Step 2: Scan local files
        local_assets = list_local_files_with_size(LOCAL_BASE)
        
        # Also scan special files at root
        local_special = {}
        for special in SPECIAL_FILES:
            local_path = os.path.join(LOCAL_ROOT, special)
            if os.path.isfile(local_path):
                size = os.path.getsize(local_path)
                file_hash = compute_file_hash(local_path)
                local_special[special] = {'path': local_path, 'size': size, 'hash': file_hash}
        
        p(f"  Local:  {C.GREEN}{len(local_assets)}{C.R} asset files, {C.GREEN}{len(local_special)}{C.R} special files")

        # Step 3: Compare asset files (size only, fast)
        identical_count = 0
        files_to_upload = []
        
        for relative_path, local_info in local_assets.items():
            if relative_path in remote_assets:
                remote_info = remote_assets[relative_path]
                if local_info['size'] == remote_info['size']:
                    identical_count += 1
                    continue
                files_to_upload.append((relative_path, local_info['path'], 
                                       remote_info['path'], "CHANGED"))
            else:
                files_to_upload.append((relative_path, local_info['path'], 
                                       normalize_path(os.path.join(REMOTE_BASE, relative_path)), "NEW"))
        
        # Step 4: Compare special files (hash verification)
        for special, local_info in local_special.items():
            if special in remote_special:
                remote_info = remote_special[special]
                remote_hash = get_remote_file_hash(main_sftp, remote_info['path'])
                if local_info['hash'] == remote_hash:
                    identical_count += 1
                    continue
                files_to_upload.append((special, local_info['path'], 
                                       remote_info['path'], "CHANGED"))
            else:
                files_to_upload.append((special, local_info['path'], 
                                       normalize_path(os.path.join(REMOTE_ROOT, special)), "NEW"))
        
        # Step 5: Check for special files to delete
        files_to_delete = []
        for special, remote_info in remote_special.items():
            if special not in local_special:
                files_to_delete.append((special, remote_info['path']))
        
        p(f"  Identical: {C.GREEN}{identical_count}{C.R} files")
        p(f"  To upload: {C.GREEN}{len(files_to_upload)}{C.R} files")
        p(f"  To delete: {C.RED}{len(files_to_delete)}{C.R} files")

        # Step 6: Upload files in parallel
        if files_to_upload:
            p()
            p(f"{C.CYAN}Uploading files...{C.R}")
            pb = ProgressBar(len(files_to_upload), "Uploading")
            
            with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
                fs = {executor.submit(upload_file, pool, lp, rp, pb): (rp, st) 
                      for rp, lp, st, _ in files_to_upload}
                
                for future in as_completed(fs):
                    remote_path, status = fs[future]
                    success, error = future.result()
                    pb.update(1)
            
            pb.finish()
        else:
            p(f"{C.GREEN}No files to upload{C.R}")

        # Step 7: Delete files in parallel
        if files_to_delete:
            p()
            p(f"{C.CYAN}Deleting files...{C.R}")
            pb = ProgressBar(len(files_to_delete), "Deleting")
            
            with ThreadPoolExecutor(max_workers=MAX_THREADS) as executor:
                fs = {executor.submit(delete_file, pool, rp, pb): rp 
                      for rp, _ in files_to_delete}
                
                for future in as_completed(fs):
                    remote_path = fs[future]
                    success, error = future.result()
                    pb.update(1)
            
            pb.finish()
        else:
            p(f"{C.GREEN}No files to delete{C.R}")

        # Step 8: Clean up empty directories (assets only)
        p(f"{C.CYAN}Cleaning up...{C.R}")
        cleanup_count = 0
        
        all_dirs = set()
        for root, dirs, _ in sftp_walk(main_sftp, REMOTE_BASE):
            for d in dirs:
                all_dirs.add(normalize_path(os.path.join(root, d)))
        
        sorted_dirs = sorted(all_dirs, key=lambda x: x.count("/"), reverse=True)
        for remote_dir in sorted_dirs:
            if remote_dir == normalize_path(REMOTE_BASE):
                continue
            try:
                files_in_dir = list(main_sftp.listdir(remote_dir))
                if len(files_in_dir) == 0:
                    main_sftp.rmdir(remote_dir)
                    cleanup_count += 1
            except Exception:
                pass
        
        p(f"  Cleaned: {C.PINK}{cleanup_count}{C.R} empty directories")

        # Summary
        p()
        p(f"{C.BOLD + C.GREEN}done{C.R}")
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
    if not os.path.exists(LOCAL_BASE):
        p(f"\n{C.BG_RED}{C.WHITE} ERROR {C.R}: Local directory not found: {LOCAL_BASE}", C.RED)
        sys.exit(1)

    try:
        import paramiko
    except ImportError:
        p(f"\n{C.BG_RED}{C.WHITE} ERROR {C.R}: paramiko is not installed.", C.RED)
        p(f"  Please run: {C.YELLOW}pip install paramiko{C.R}")
        sys.exit(1)

    sync_assets()
