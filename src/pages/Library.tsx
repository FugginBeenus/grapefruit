import { useState, useMemo } from "react";
import { useDeviceStore } from "../stores/deviceStore";
import { SearchInput } from "../components/SearchInput";
import { TrackList } from "../components/TrackList";
import { ProgressBar } from "../components/ProgressBar";
import { useProgress } from "../hooks/useProgress";

export default function Library() {
  const { selectedDevice, tracks, loadingLibrary, refreshLibrary } = useDeviceStore();
  const [search, setSearch] = useState("");
  const progress = useProgress("scan_device_library");

  const filtered = useMemo(() => {
    if (!search.trim()) return tracks;
    const q = search.toLowerCase();
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
    );
  }, [tracks, search]);

  if (!selectedDevice) {
    return <EmptyState message="Connect a device to browse its library" />;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] gap-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-t">Library</h1>
          <p className="text-[13px] text-t-secondary mt-1">
            {tracks.length > 0
              ? `${filtered.length.toLocaleString()} track${filtered.length !== 1 ? "s" : ""}${search ? ` matching "${search}"` : ""}`
              : "Scan your device to load tracks"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-60">
            <SearchInput value={search} onChange={setSearch} placeholder="Filter tracks..." />
          </div>
          <button
            onClick={() => refreshLibrary()}
            disabled={loadingLibrary}
            className="btn btn-secondary"
          >
            {loadingLibrary ? "Scanning..." : tracks.length > 0 ? "Rescan" : "Scan Library"}
          </button>
        </div>
      </div>

      {/* Progress */}
      {loadingLibrary && progress.total > 0 && (
        <ProgressBar
          percent={progress.percent}
          label="Scanning device..."
          sublabel={`${progress.current.toLocaleString()} / ${progress.total.toLocaleString()}`}
        />
      )}

      {/* Tracks */}
      <div className="flex-1 min-h-0">
        <TrackList tracks={filtered} height={window.innerHeight - 200} />
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center gap-4">
      <div className="w-14 h-14 rounded-2xl bg-bg-surface flex items-center justify-center">
        <svg className="w-7 h-7 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
        </svg>
      </div>
      <p className="text-t-secondary text-sm">{message}</p>
    </div>
  );
}
