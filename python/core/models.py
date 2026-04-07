from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional


class MatchStatus(Enum):
    MATCHED = "matched"
    UNCERTAIN = "uncertain"
    MISSING = "missing"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    MANUAL = "manual"


class PathMode(Enum):
    ABSOLUTE = "absolute"
    RELATIVE = "relative"


@dataclass
class PlaylistTrack:
    """A track from an Apple Music playlist (URL or XML)."""
    title: str
    artist: str
    album: str = ""
    duration_seconds: Optional[float] = None
    track_number: Optional[int] = None
    source_index: int = 0


@dataclass
class LocalTrack:
    """A music file found on the local filesystem."""
    file_path: Path
    title: str
    artist: str
    album: str = ""
    duration_seconds: Optional[float] = None
    track_number: Optional[int] = None
    normalized_title: str = ""
    normalized_artist: str = ""


@dataclass
class MatchCandidate:
    """A potential match between a playlist track and a local file."""
    local_track: LocalTrack
    score: float
    matched_on: str = ""


@dataclass
class MatchResult:
    """The matching outcome for one playlist track."""
    playlist_track: PlaylistTrack
    status: MatchStatus
    best_match: Optional[MatchCandidate] = None
    candidates: list[MatchCandidate] = field(default_factory=list)
    user_selected: Optional[LocalTrack] = None


@dataclass
class ExportOptions:
    """Options for M3U8 output."""
    output_path: Path = field(default_factory=lambda: Path.home() / "Desktop" / "playlist.m3u8")
    path_mode: PathMode = PathMode.ABSOLUTE
    include_unmatched_comments: bool = True
    rockbox_root: Optional[Path] = None


@dataclass
class PlaylistMetadata:
    """Metadata about the source playlist."""
    name: str
    description: str = ""
    track_count: int = 0
    source_url: Optional[str] = None
    source_type: str = ""


# ── iPod Management Models ──────────────────────────────────────────


class DeviceFirmware(Enum):
    ROCKBOX = "rockbox"
    APPLE = "apple"
    UNKNOWN = "unknown"


class SyncMode(Enum):
    FULL = "full"
    SELECTIVE = "selective"
    DELTA = "delta"


class SyncStatus(Enum):
    PENDING = "pending"
    COPYING = "copying"
    COMPLETE = "complete"
    SKIPPED = "skipped"
    ERROR = "error"


@dataclass
class DeviceInfo:
    """A connected iPod device."""
    mount_point: Path
    firmware: DeviceFirmware
    label: str = ""
    model: str = ""
    total_bytes: int = 0
    used_bytes: int = 0
    free_bytes: int = 0

    @property
    def free_gb(self) -> float:
        return self.free_bytes / (1024 ** 3)

    @property
    def total_gb(self) -> float:
        return self.total_bytes / (1024 ** 3)

    @property
    def used_gb(self) -> float:
        return self.used_bytes / (1024 ** 3)

    @property
    def used_fraction(self) -> float:
        return self.used_bytes / self.total_bytes if self.total_bytes else 0.0


@dataclass
class DeviceTrack:
    """A music file on the iPod device."""
    file_path: Path
    relative_path: str
    title: str
    artist: str
    album: str = ""
    duration_seconds: Optional[float] = None
    track_number: Optional[int] = None
    file_size: int = 0
    format: str = ""


@dataclass
class SyncRecord:
    """Tracks a synced file in the manifest database."""
    local_path: str
    device_path: str
    file_size: int
    mtime: float
    synced_at: float
    checksum: str = ""


@dataclass
class SyncPlan:
    """Result of computing what needs to be synced."""
    files_to_copy: list = field(default_factory=list)
    files_to_delete: list = field(default_factory=list)
    files_unchanged: list = field(default_factory=list)
    total_copy_bytes: int = 0
    total_delete_bytes: int = 0
    device_free_bytes: int = 0

    @property
    def fits_on_device(self) -> bool:
        needed = self.total_copy_bytes - self.total_delete_bytes
        return needed <= self.device_free_bytes

    @property
    def shortfall_bytes(self) -> int:
        needed = self.total_copy_bytes - self.total_delete_bytes
        return max(0, needed - self.device_free_bytes)


@dataclass
class TransferProgress:
    """Progress state for an ongoing file transfer."""
    current_file: str = ""
    current_file_index: int = 0
    total_files: int = 0
    bytes_copied: int = 0
    total_bytes: int = 0
    errors: list = field(default_factory=list)

    @property
    def file_fraction(self) -> float:
        return self.current_file_index / self.total_files if self.total_files else 0.0

    @property
    def byte_fraction(self) -> float:
        return self.bytes_copied / self.total_bytes if self.total_bytes else 0.0
