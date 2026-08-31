"""Safe SQLite backups for the desktop application."""

from __future__ import annotations

import sqlite3
import tempfile
from datetime import date, datetime
from pathlib import Path

from sqlalchemy.engine import make_url

from ..config import settings


REQUIRED_TABLES = {"accounts", "categories", "transactions"}


def database_path() -> Path | None:
    url = make_url(settings.database_url)
    if url.drivername != "sqlite" or not url.database or url.database == ":memory:":
        return None
    return Path(url.database).expanduser().resolve()


def backup_directory() -> Path:
    path = database_path()
    if path is None:
        raise RuntimeError("Los respaldos administrados están disponibles en la aplicación desktop")
    directory = path.parent / "backups"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _copy_database(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source) as source_db, sqlite3.connect(destination) as destination_db:
        source_db.backup(destination_db)


def validate_database(path: Path) -> None:
    try:
        with sqlite3.connect(path) as connection:
            result = connection.execute("PRAGMA quick_check").fetchone()
            if not result or result[0] != "ok":
                raise ValueError("El archivo no supera la verificación de integridad")
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            missing = REQUIRED_TABLES - tables
            if missing:
                raise ValueError("El archivo no es un respaldo completo de MAPI")
    except sqlite3.DatabaseError as exc:
        raise ValueError("El archivo seleccionado no es una base de datos válida de MAPI") from exc


def create_backup(kind: str = "manual", *, force: bool = True) -> Path:
    source = database_path()
    if source is None or not source.exists():
        raise RuntimeError("No se encontró la base local de MAPI")
    directory = backup_directory()
    if kind == "auto":
        destination = directory / f"mapi-auto-{date.today().isoformat()}.sqlite3"
    else:
        stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        destination = directory / f"mapi-{kind}-{stamp}.sqlite3"
    if force or not destination.exists():
        _copy_database(source, destination)
        validate_database(destination)
    prune_automatic_backups(directory)
    return destination


def ensure_daily_backup() -> Path | None:
    source = database_path()
    if source is None or not source.exists():
        return None
    return create_backup("auto", force=False)


def prune_automatic_backups(directory: Path, keep: int = 30) -> None:
    automatic = sorted(directory.glob("mapi-auto-*.sqlite3"), key=lambda item: item.stat().st_mtime, reverse=True)
    for old in automatic[keep:]:
        old.unlink(missing_ok=True)


def list_backups() -> list[dict]:
    result = []
    for path in sorted(backup_directory().glob("*.sqlite3"), key=lambda item: item.stat().st_mtime, reverse=True):
        stat = path.stat()
        name = path.name
        kind = "automatic" if name.startswith("mapi-auto-") else "pre_restore" if "pre-restore" in name else "manual"
        result.append({
            "filename": name,
            "kind": kind,
            "size": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        })
    return result


def resolve_backup(filename: str) -> Path:
    safe_name = Path(filename).name
    if safe_name != filename:
        raise ValueError("Nombre de respaldo inválido")
    path = backup_directory() / safe_name
    if not path.is_file():
        raise FileNotFoundError(filename)
    return path


def restore_uploaded_database(content: bytes) -> Path:
    live = database_path()
    if live is None:
        raise RuntimeError("La restauración administrada está disponible en la aplicación desktop")
    with tempfile.NamedTemporaryFile(prefix="mapi-restore-", suffix=".sqlite3", delete=False) as handle:
        handle.write(content)
        uploaded = Path(handle.name)
    try:
        validate_database(uploaded)
        safety = create_backup("pre-restore")
        _copy_database(uploaded, live)
        validate_database(live)
        return safety
    finally:
        uploaded.unlink(missing_ok=True)
