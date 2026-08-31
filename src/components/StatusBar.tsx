import { useDeviceStore } from "../stores/deviceStore";

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}H ${m}M` : `${m}M`;
}

function fmtSize(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export function StatusBar() {
  const { selectedDevice, tracks } = useDeviceStore();
  const duration = tracks.reduce((s, t) => s + (t.duration_seconds ?? 0), 0);
  const size = tracks.reduce((s, t) => s + (t.file_size ?? 0), 0);
  const isLocal = selectedDevice?.firmware === "local";

  return (
    <div className="h-9 shrink-0 px-[18px] bg-panel border-t border-line flex items-center gap-4 font-mono text-[9px] text-ink3 overflow-hidden">
      <div className="flex items-center gap-[7px] shrink-0">
        <span className="w-[5px] h-[5px] rounded-full" style={{ background: "var(--emer)" }} />
        <span className="text-ink2">ENGINE READY</span>
      </div>
      {tracks.length > 0 && (
        <>
          <div className="shrink-0">{tracks.length.toLocaleString()} TRACKS</div>
          {duration > 0 && <div className="shrink-0">{fmtDuration(duration)}</div>}
          {size > 0 && <div className="shrink-0">{fmtSize(size)}</div>}
        </>
      )}
      <div className="flex-1" />
      {selectedDevice ? (
        isLocal ? (
          <div className="shrink-0 truncate max-w-[50%]">{String(selectedDevice.mount_point).toUpperCase()}</div>
        ) : (
          <div className="shrink-0" style={{ color: "var(--cyan)" }}>
            {(selectedDevice.label || "DEVICE").toUpperCase()} {fmtSize(selectedDevice.used_bytes)}/{fmtSize(selectedDevice.capacity_bytes)}
          </div>
        )
      ) : (
        <div className="shrink-0">NO LIBRARY CONNECTED</div>
      )}
    </div>
  );
}
