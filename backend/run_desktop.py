"""Desktop entry point bundled as the MAPI Tauri sidecar."""

import argparse
import os
import threading
import time
from pathlib import Path


def exit_when_parent_stops(parent_pid: int) -> None:
    """Prevent the PyInstaller worker from surviving after MAPI closes."""
    while True:
        try:
            os.kill(parent_pid, 0)
        except ProcessLookupError:
            os._exit(0)
        except PermissionError:
            pass
        time.sleep(0.5)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--port", type=int, default=18421)
    parser.add_argument("--parent-pid", type=int)
    args = parser.parse_args()

    if args.parent_pid:
        threading.Thread(target=exit_when_parent_stops, args=(args.parent_pid,), daemon=True).start()

    data_dir = Path(args.data_dir).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["DATABASE_URL"] = f"sqlite:///{data_dir / 'mapi.sqlite3'}"
    os.environ["CORS_ORIGINS"] = "http://localhost:5173,tauri://localhost,http://tauri.localhost"

    import uvicorn
    from app.main import app as mapi_app

    uvicorn.run(mapi_app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
