"""Kept so older copies of run.py (which start gunicorn with -c gunicorn_conf.py) still work. The real settings live in app/gunicorn_conf.py."""
from app.gunicorn_conf import *  # noqa: F401,F403
from app.gunicorn_conf import on_starting  # noqa: F401
