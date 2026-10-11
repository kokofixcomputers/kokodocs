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

`python run.py` (and `gunicorn -c app/gunicorn_conf.py app.main:app`, as in `kokodocs.service`) runs gunicorn with one worker plus a watcher: whenever a `.py` file under `backend/` changes, it waits two seconds for the changes to stop (an upload of many files takes a moment), checks that every changed file compiles, and then reloads gracefully. The new worker starts before the old one stops, so nothing is refused, and open pages reconnect on their own. If a file doesn't compile it logs `code changed but NOT reloaded` and the site keeps running the old code until you fix it. Set `KOKO_AUTORELOAD=0` to turn the watcher off.

- **Docker or a panel:** nothing to configure beyond installing `gunicorn` (it is in the requirements files) and starting with `python run.py`. Upload the new files into the running container's folder and it reloads itself. Changes baked into a new image still need a container restart. Reload by hand with `docker kill -s HUP <container>` (gunicorn is the container's main process).
- **systemd:** `sudo systemctl reload kokodocs` also works.
- Keep it to one worker: open documents live in the process. Saving a document merges with what is already stored when another copy saved in between, so the moment both copies run overlaps safely.
- Tested: a reload during a stream of requests dropped none; a file with a syntax error was not loaded and the site stayed up; fixing it reloaded.
- `KOKO_NO_GUNICORN=1` runs plain uvicorn (restarts on every deploy). Windows has no gunicorn, so it always uses uvicorn.
