import sqlite3

from app.config import settings
from app.services.backups import create_backup, ensure_daily_backup, list_backups, restore_uploaded_database


def make_mapi_database(path, marker="original"):
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE accounts (id TEXT, name TEXT)")
        connection.execute("CREATE TABLE categories (id TEXT, name TEXT)")
        connection.execute("CREATE TABLE transactions (id TEXT, description TEXT)")
        connection.execute("INSERT INTO accounts VALUES ('1', ?)", (marker,))


def test_daily_manual_and_restore_round_trip(tmp_path, monkeypatch):
    live = tmp_path / "mapi.sqlite3"
    make_mapi_database(live)
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{live}")

    daily = ensure_daily_backup()
    assert daily is not None and daily.exists()
    assert ensure_daily_backup() == daily
    manual = create_backup("manual")
    assert manual.exists()
    assert {item["kind"] for item in list_backups()} == {"automatic", "manual"}

    replacement = tmp_path / "replacement.sqlite3"
    make_mapi_database(replacement, "restored")
    safety = restore_uploaded_database(replacement.read_bytes())
    assert safety.exists()
    with sqlite3.connect(live) as connection:
        assert connection.execute("SELECT name FROM accounts").fetchone()[0] == "restored"
    assert any(item["kind"] == "pre_restore" for item in list_backups())


def test_restore_rejects_non_mapi_file(tmp_path, monkeypatch):
    live = tmp_path / "mapi.sqlite3"
    make_mapi_database(live)
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{live}")
    try:
        restore_uploaded_database(b"not sqlite")
    except ValueError as exc:
        assert "base de datos" in str(exc)
    else:
        raise AssertionError("invalid backup was accepted")
