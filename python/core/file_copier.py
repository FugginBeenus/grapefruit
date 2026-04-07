import os
import shutil
from pathlib import Path

from core.models import TransferProgress


class FileCopier:
    """Copies files with progress reporting."""

    CHUNK_SIZE = 1024 * 1024  # 1 MB chunks

    def __init__(self):
        self._cancelled = False

    def copy_with_progress(self, src: Path, dst: Path, progress_callback=None) -> bool:
        """Copy a single file with chunk-based progress. Returns True on success."""
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            total = src.stat().st_size
            copied = 0

            with open(src, "rb") as fsrc, open(dst, "wb") as fdst:
                while True:
                    chunk = fsrc.read(self.CHUNK_SIZE)
                    if not chunk:
                        break
                    fdst.write(chunk)
                    copied += len(chunk)
                    if progress_callback:
                        progress_callback(copied, total)

            # Preserve metadata (timestamps, permissions)
            shutil.copystat(str(src), str(dst))
            return True
        except OSError:
            # Clean up partial file on failure
            try:
                if dst.exists():
                    dst.unlink()
            except OSError:
                pass
            return False

    def copy_batch(self, file_pairs: list[tuple[Path, Path]], progress_callback=None) -> TransferProgress:
        """Copy multiple files with overall progress tracking."""
        self._cancelled = False
        progress = TransferProgress(
            total_files=len(file_pairs),
            total_bytes=sum(src.stat().st_size for src, _ in file_pairs if src.exists()),
        )

        for i, (src, dst) in enumerate(file_pairs):
            if self._cancelled:
                break

            progress.current_file = src.name
            progress.current_file_index = i

            if progress_callback:
                progress_callback(progress)

            success = self.copy_with_progress(src, dst)

            if success:
                progress.bytes_copied += src.stat().st_size
            else:
                progress.errors.append(f"Failed to copy: {src.name}")

        progress.current_file_index = len(file_pairs) if not self._cancelled else progress.current_file_index
        progress.current_file = ""

        if progress_callback:
            progress_callback(progress)

        return progress

    def cancel(self):
        """Cancel an in-progress batch copy."""
        self._cancelled = True
