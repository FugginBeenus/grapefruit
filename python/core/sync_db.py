import sqlite3
import time
from pathlib import Path

from core.models import SyncRecord


class SyncDatabase:
    """SQLite manifest tracking sync state, stored on the device itself."""

    DB_FILENAME = ".music_sync.db"

    def __init__(self, device_root: Path):
        self._db_path = device_root / self.DB_FILENAME
        self._conn: sqlite3.Connection | None = None
        self._ensure_db()

    def _ensure_db(self):
        """Create database and tables if they don't exist."""
        self._conn = sqlite3.connect(str(self._db_path))
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS sync_records (
                local_path TEXT PRIMARY KEY,
                device_path TEXT NOT NULL,
                file_size INTEGER,
                mtime REAL,
                synced_at REAL,
                checksum TEXT DEFAULT ''
            )
        """)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS sync_config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        self._conn.commit()

    def get_record(self, local_path: str) -> SyncRecord | None:
        """Look up a sync record by local path."""
        cur = self._conn.execute(
            "SELECT local_path, device_path, file_size, mtime, synced_at, checksum "
            "FROM sync_records WHERE local_path = ?",
            (local_path,),
        )
        row = cur.fetchone()
        if row:
            return SyncRecord(*row)
        return None

    def upsert_record(self, record: SyncRecord):
        """Insert or update a sync record."""
        self._conn.execute(
            "INSERT OR REPLACE INTO sync_records "
            "(local_path, device_path, file_size, mtime, synced_at, checksum) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (record.local_path, record.device_path, record.file_size,
             record.mtime, record.synced_at, record.checksum),
        )
        self._conn.commit()

    def delete_record(self, local_path: str):
        """Remove a sync record."""
        self._conn.execute("DELETE FROM sync_records WHERE local_path = ?", (local_path,))
        self._conn.commit()

    def get_all_records(self) -> list[SyncRecord]:
        """Return all sync records."""
        cur = self._conn.execute(
            "SELECT local_path, device_path, file_size, mtime, synced_at, checksum "
            "FROM sync_records"
        )
        return [SyncRecord(*row) for row in cur.fetchall()]

    def get_device_paths(self) -> set[str]:
        """Return all device paths currently tracked."""
        cur = self._conn.execute("SELECT device_path FROM sync_records")
        return {row[0] for row in cur.fetchall()}

    def set_config(self, key: str, value: str):
        """Store a configuration value."""
        self._conn.execute(
            "INSERT OR REPLACE INTO sync_config (key, value) VALUES (?, ?)",
            (key, value),
        )
        self._conn.commit()

    def get_config(self, key: str) -> str | None:
        """Retrieve a configuration value."""
        cur = self._conn.execute("SELECT value FROM sync_config WHERE key = ?", (key,))
        row = cur.fetchone()
        return row[0] if row else None

    def close(self):
        """Close the database connection."""
        if self._conn:
            self._conn.close()
            self._conn = None
