import { useDeviceStore } from "../stores/deviceStore";

function formatDuration(seconds: number): string {
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(1)} MB`;
}

export function StatusBar() {
  const { selectedDevice, tracks } = useDeviceStore();

  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration_seconds ?? 0), 0);
  const totalSize = tracks.reduce((sum, t) => sum + (t.file_size ?? 0), 0);

  const usagePct =
    selectedDevice && selectedDevice.capacity_bytes > 0
      ? (selectedDevice.used_bytes / selectedDevice.capacity_bytes) * 100
      : 0;

  return (
    <div className="h-9 shrink-0 flex items-center justify-between px-4 border-t text-[12px] select-none" style={{ background: "linear-gradient(90deg, #0F0F15 0%, #0B0B10 100%)" }}>
      {/* Left: track stats */}
      <div className="flex items-center gap-3 text-t-muted">
        {tracks.length > 0 ? (
          <>
            <span className="text-cyan">{tracks.length.toLocaleString()} tracks</span>
            {totalDuration > 0 && <><span className="text-b-light">&middot;</span> <span className="text-violet">{formatDuration(totalDuration)}</span></>}
            {totalSize > 0 && <><span className="text-b-light">&middot;</span> <span className="text-amber">{formatSize(totalSize)}</span></>}
          </>
        ) : (
          <span>No tracks loaded</span>
        )}
      </div>

      {/* Center: operation status (slot for future use) */}
      <div className="text-t-muted" />

      {/* Right: device info */}
      <div className="flex items-center gap-2 text-t-muted">
        {selectedDevice ? (
          <>
            <span className="dot dot-ok" />
            <span className="text-t-secondary">{selectedDevice.label || "Device"}</span>
            <span className={usagePct > 90 ? "text-err" : ""}>
              {formatSize(selectedDevice.used_bytes)} / {formatSize(selectedDevice.capacity_bytes)}
            </span>
          </>
        ) : (
          <span>No device connected</span>
        )}
      </div>
    </div>
  );
}
