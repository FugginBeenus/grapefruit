import os
import time
from pathlib import Path

from core.models import (
    DeviceInfo, SyncMode, SyncPlan, SyncRecord, TransferProgress,
)
from core.sync_db import SyncDatabase
from core.file_copier import FileCopier
from core.local_scanner import AUDIO_EXTENSIONS


class SyncEngine:
    """Computes and executes sync between local library and device.

    Uses filesystem-based comparison: scans what's actually on the device
    and compares to the local library. This works regardless of whether
    music was copied manually, by another tool, or by a previous sync.
    """

    DEVICE_MUSIC_DIR = "Music"

    def __init__(self, device: DeviceInfo, sync_db: SyncDatabase):
        self._device = device
        self._db = sync_db
        self._copier = FileCopier()
        self._cancelled = False

    def compute_plan(self, source_paths: list[Path], mode: SyncMode,
                     progress_callback=None) -> SyncPlan:
        """Analyze what needs to be synced by comparing actual device files to local library."""

        # ── Phase 1: Scan what's actually on the device ──────────────
        device_music_root = self._device.mount_point / self.DEVICE_MUSIC_DIR
        device_files = {}  # relative_path (lowercase) → (full_path, file_size)

        if device_music_root.exists():
            for root, dirs, files in os.walk(device_music_root):
                dirs[:] = [d for d in dirs if not d.startswith(".")]
                for f in files:
                    if f.startswith("."):
                        continue
                    fp = Path(root) / f
                    ext = fp.suffix.lower()
                    if ext in AUDIO_EXTENSIONS:
                        try:
                            rel = str(fp.relative_to(self._device.mount_point))
                            device_files[rel.lower()] = (fp, fp.stat().st_size)
                        except (OSError, ValueError):
                            pass

        if progress_callback:
            progress_callback(0, 0)  # signal: device scan done

        # ── Phase 2: Collect local source files ──────────────────────
        source_files = []
        for source in source_paths:
            if source.is_file():
                if source.suffix.lower() in AUDIO_EXTENSIONS:
                    source_files.append((source, source.parent))
            elif source.is_dir():
                for root, dirs, files in os.walk(source):
                    dirs[:] = [d for d in dirs if not d.startswith(".")]
                    for f in files:
                        if f.startswith("."):
                            continue
                        fp = Path(root) / f
                        if fp.suffix.lower() in AUDIO_EXTENSIONS:
                            source_files.append((fp, source))

        # ── Phase 3: Compare ─────────────────────────────────────────
        total = len(source_files)
        files_to_copy = []
        files_unchanged = []
        total_copy_bytes = 0

        for i, (file_path, source_root) in enumerate(source_files):
            try:
                stat = file_path.stat()
                file_size = stat.st_size
            except OSError:
                continue

            # Compute what the device path WOULD be
            device_rel = self._compute_device_path(file_path, source_root)
            device_key = device_rel.lower()

            # Check if the file already exists on the device with same size
            if device_key in device_files:
                existing_path, existing_size = device_files[device_key]
                if existing_size == file_size:
                    # File already on device and same size → unchanged
                    files_unchanged.append(file_path)
                else:
                    # File exists but different size → needs re-copy
                    files_to_copy.append((file_path, source_root))
                    total_copy_bytes += file_size
            else:
                # File not on device → needs copy
                files_to_copy.append((file_path, source_root))
                total_copy_bytes += file_size

            if progress_callback and (i % 100 == 0 or i == total - 1):
                progress_callback(i + 1, total)

        # ── Phase 3b: For DELTA mode, only copy changed files ─────────
        if mode == SyncMode.DELTA:
            delta_copy = []
            delta_bytes = 0
            for file_path, source_root in files_to_copy:
                record = self._db.get_record(str(file_path))
                try:
                    stat = file_path.stat()
                except OSError:
                    continue
                # Copy if no record exists or mtime/size changed
                if not record or record.mtime != stat.st_mtime or record.file_size != stat.st_size:
                    delta_copy.append((file_path, source_root))
                    delta_bytes += stat.st_size
            files_to_copy = delta_copy
            total_copy_bytes = delta_bytes

        # ── Phase 4: For FULL mode, find device files to delete ──────
        files_to_delete = []
        total_delete_bytes = 0
        if mode == SyncMode.FULL:
            # Build set of expected device paths from source
            expected_keys = set()
            for file_path, source_root in source_files:
                rel = self._compute_device_path(file_path, source_root)
                expected_keys.add(rel.lower())

            for device_key, (device_path, device_size) in device_files.items():
                if device_key not in expected_keys:
                    files_to_delete.append(device_path)
                    total_delete_bytes += device_size

        return SyncPlan(
            files_to_copy=[fp for fp, _ in files_to_copy],
            files_to_delete=files_to_delete,
            files_unchanged=files_unchanged,
            total_copy_bytes=total_copy_bytes,
            total_delete_bytes=total_delete_bytes,
            device_free_bytes=self._device.free_bytes,
        )

    def execute_plan(self, plan: SyncPlan, source_paths: list[Path],
                     progress_callback=None) -> TransferProgress:
        """Execute the sync plan."""
        self._cancelled = False
        progress = TransferProgress(
            total_files=len(plan.files_to_copy) + len(plan.files_to_delete),
            total_bytes=plan.total_copy_bytes,
        )

        # Phase 1: Delete obsolete files
        for device_path in plan.files_to_delete:
            if self._cancelled:
                break
            try:
                device_path.unlink()
                self._cleanup_empty_dirs(device_path.parent)
            except OSError as e:
                progress.errors.append(f"Delete failed: {device_path.name} - {e}")

        # Phase 2: Copy new/changed files
        # Rebuild source_root mapping
        source_root_map = {}
        for source in source_paths:
            if source.is_dir():
                for root, dirs, files in os.walk(source):
                    dirs[:] = [d for d in dirs if not d.startswith(".")]
                    for f in files:
                        if f.startswith("."):
                            continue
                        fp = Path(root) / f
                        source_root_map[str(fp)] = source

        for i, file_path in enumerate(plan.files_to_copy):
            if self._cancelled:
                break

            progress.current_file = file_path.name
            progress.current_file_index = i + len(plan.files_to_delete)

            if progress_callback:
                progress_callback(progress)

            # Compute destination path
            source_root = source_root_map.get(str(file_path), file_path.parent)
            device_path = self._compute_device_path(file_path, source_root)
            full_device_path = self._device.mount_point / device_path

            # Copy the file
            success = self._copier.copy_with_progress(file_path, full_device_path)

            if success:
                stat = file_path.stat()
                record = SyncRecord(
                    local_path=str(file_path),
                    device_path=device_path,
                    file_size=stat.st_size,
                    mtime=stat.st_mtime,
                    synced_at=time.time(),
                )
                self._db.upsert_record(record)
                progress.bytes_copied += stat.st_size
            else:
                progress.errors.append(f"Copy failed: {file_path.name}")

        progress.current_file = ""
        progress.current_file_index = progress.total_files

        if progress_callback:
            progress_callback(progress)

        return progress

    def cancel(self):
        """Cancel in-progress sync."""
        self._cancelled = True
        self._copier.cancel()

    def _compute_device_path(self, local_path: Path, source_root: Path) -> str:
        """Map local path to device destination preserving folder structure."""
        try:
            relative = local_path.relative_to(source_root)
        except ValueError:
            relative = Path(local_path.name)

        device_path = Path(self.DEVICE_MUSIC_DIR) / relative
        return str(device_path)

    def _cleanup_empty_dirs(self, dir_path: Path):
        """Remove empty parent directories up to the music root."""
        music_root = self._device.mount_point / self.DEVICE_MUSIC_DIR
        try:
            while dir_path != music_root and dir_path.exists():
                if any(dir_path.iterdir()):
                    break
                dir_path.rmdir()
                dir_path = dir_path.parent
        except OSError:
            pass
