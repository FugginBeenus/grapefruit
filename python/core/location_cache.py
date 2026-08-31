"""Persistent index of a device's contents, so a track can be tagged as
'on the device' even when the device isn't currently connected.

Stored as lowercased file basenames — the fast identity for local sources that
share files (the device is synced from the library, so filenames match). No
per-file tag reads required to build or match it.
"""

import json
from pathlib import Path

CACHE_PATH = Path.home() / ".grapefruit" / "device_index.json"


def save_device_index(basenames, label: str = "") -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(
        json.dumps({"label": label, "names": sorted(basenames)}),
        encoding="utf-8",
    )


def load_device_index():
    """Return {'label': str, 'names': set[str]} or None."""
    if not CACHE_PATH.exists():
        return None
    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        return {"label": data.get("label", ""), "names": set(data.get("names", []))}
    except Exception:
        return None
