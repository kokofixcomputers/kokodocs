# KokoDocs Deployment

## SFTP Sync Script

A **colorful** script that syncs static assets from your local build to the hosting server.

### Usage

```bash
# Install dependencies (if not already installed)
python3 -m pip install -r requirements.txt

# Run the sync script
python3 sync_assets.py
```

The script will:
1. Display a **cool ASCII art header** 🎨
2. Prompt you for the SFTP password
3. Connect to `sftp://hosting.kokodev.cc:2022` as user `kokofixcomputers.abcd87d4`
4. Compare files in `frontend/dist/assets` on both local and remote (using SHA256 hash)
5. **Upload** only new or changed files (colored output)
6. **Delete** files on the server that don't exist locally
7. Clean up empty directories on the server
8. Display a **colorful summary** with ASCII art and say "done"

### Colors Used

| Status | Color |
|--------|-------|
| NEW files | 🟢 Green |
| CHANGED files | 🟠 Orange |
| IDENTICAL files | ⚪ Dim White |
| SKIP files | 🟡 Yellow |
| DELETE files | 🔴 Red |
| CLEANUP directories | 🪈 Pink |
| Headers | 🔵 Blue |
| Success messages | 🟢 Green |
| Error messages | 🔴 Red |

### Configuration

Edit the script to change:
- `HOST`, `PORT`, `USERNAME`: SFTP connection details
- `REMOTE_BASE`: Remote directory path
- `LOCAL_BASE`: Local directory path
- `HASH_ALGORITHM`: 'sha256' (default) or 'md5'

### Notes

- The script uses **paramiko** for SFTP (Pure Python, no external dependencies)
- Password is entered securely via `getpass` (not visible in terminal)
- Empty directories are cleaned up automatically
- All operations are logged with **color-coded status messages**
- Works on macOS/Linux terminals with ANSI color support

## Updating without downtime

Run the app under gunicorn (see `kokodocs.service`, one worker only) and update with `sudo systemctl reload kokodocs`. The gunicorn master keeps the port open, starts a new worker with the new code, then retires the old one; people editing reconnect on their own. Tested here: a reload during a stream of requests dropped none. Saving a document merges with what is already stored when another copy saved in between, so the moment both copies run overlaps safely. `systemctl restart` (and `python run.py`, which has no master process) still stops for a few seconds; Caddy's `lb_try_duration` hides that from visitors.
