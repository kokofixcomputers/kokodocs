"""Start-file shim: `python backend/main.py` runs the app via ../run.py."""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).resolve().parent.parent / "run.py"), run_name="__main__")
