"""App-level configuration, independent of any one service.

Currently holds the master library path — the source-of-truth music folder for
syncing — which may differ from the Plex server's library path.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

CONFIG_PATH = Path.home() / ".grapefruit" / "app_config.json"


@dataclass
class AppConfig:
    master_library_path: str = ""
    # Soulseek (via a headless slskd daemon the user runs and points us at).
    slskd_url: str = ""
    slskd_api_key: str = ""
    soulseek_download_dir: str = ""


def load_app_config() -> AppConfig:
    if not CONFIG_PATH.exists():
        return AppConfig()
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return AppConfig(
            master_library_path=data.get("master_library_path", ""),
            slskd_url=data.get("slskd_url", ""),
            slskd_api_key=data.get("slskd_api_key", ""),
            soulseek_download_dir=data.get("soulseek_download_dir", ""),
        )
    except (json.JSONDecodeError, OSError):
        return AppConfig()


def save_app_config(config: AppConfig) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")
