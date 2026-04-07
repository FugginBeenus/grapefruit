import { useState } from "react";
import { useDeviceStore } from "../stores/deviceStore";
import { usePlexStore } from "../stores/plexStore";
import { ProgressBar } from "../components/ProgressBar";
import { useProgress } from "../hooks/useProgress";
import type { PlexSyncResult } from "../types/models";

export default function PlexSync() {
  const { selectedDevice, playlists } = useDeviceStore();
  const { syncing } = usePlexStore();
  const [results, setResults] = useState<PlexSyncResult[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const progress = useProgress("plex_sync");

  if (!selectedDevice) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-bg-surface flex items-center justify-center">
          <svg className="w-7 h-7 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
          </svg>
        </div>
        <p className="text-t-secondary text-sm">Connect a device to sync playlists to Plex</p>
      </div>
    );
  }

  const togglePl = (n: string) => setSelected(s => { const next = new Set(s); next.has(n) ? next.delete(n) : next.add(n); return next; });
  const toggleAll = () => setSelected(s => s.size === playlists.length ? new Set() : new Set(playlists.map(p => p.name)));

  const handleSync = async () => {
    setError(null); setResults([]); setExpandedIdx(null);
    try {
      const names = selected.size > 0 ? Array.from(selected) : undefined;
      await usePlexStore.getState().syncAll(names);
      setResults(usePlexStore.getState().syncResults);
    } catch (e) { setError(String(e)); }
  };

  const totalMatched = results.reduce((s, r) => s + r.matched, 0);
  const totalMissing = results.reduce((s, r) => s + r.missing, 0);

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] gap-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-t">Plex Sync</h1>
          <p className="text-[13px] text-t-secondary mt-1">Push your device playlists to Plex</p>
        </div>
        <button onClick={handleSync} disabled={syncing || playlists.length === 0} className="btn btn-primary">
          {syncing ? "Syncing..." : selected.size > 0 ? `Sync ${selected.size} Playlist${selected.size !== 1 ? "s" : ""}` : "Sync All"}
        </button>
      </div>

      {syncing && (
        <ProgressBar percent={progress.percent} label={progress.message || "Syncing to Plex..."} sublabel={progress.total > 0 ? `${progress.current} / ${progress.total}` : undefined} />
      )}

      {/* Results summary */}
      {results.length > 0 && (
        <div className="card px-5 py-3 flex items-center gap-5">
          <span className="text-[13px] font-bold text-t">Results</span>
          <div className="flex gap-4 text-[12px] font-medium">
            <span className="text-ok">{totalMatched} matched</span>
            <span className="text-err">{totalMissing} missing</span>
          </div>
          <span className="text-[12px] text-t-muted">{results.length} playlist{results.length !== 1 ? "s" : ""}</span>
          <div className="flex-1" />
          <button onClick={() => { setResults([]); setSelected(new Set()); }} className="btn btn-ghost text-[12px]">Clear</button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {results.length > 0 ? (
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={i} className="card overflow-hidden">
                <button
                  onClick={() => r.missing > 0 && setExpandedIdx(expandedIdx === i ? null : i)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left"
                >
                  <StatusDot status={r.status} />
                  <span className="flex-1 text-[13px] font-medium text-t truncate">{r.name}</span>
                  <span className="text-[11px] text-ok tabular-nums">{r.matched} matched</span>
                  {r.missing > 0 && <span className="text-[11px] text-err tabular-nums">{r.missing} missing</span>}
                  <SyncLabel status={r.status} />
                  {r.missing > 0 && (
                    <svg className={`w-4 h-4 text-t-muted transition-transform ${expandedIdx === i ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>
                {expandedIdx === i && r.missing_tracks.length > 0 && (
                  <div className="border-t border-b bg-bg-primary">
                    <div className="px-4 py-2 border-b border-b">
                      <p className="text-[10px] font-bold tracking-wide text-t-muted uppercase">Missing Tracks ({r.missing_tracks.length})</p>
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      {r.missing_tracks.map((t, ti) => (
                        <div key={ti} className="flex items-center gap-3 px-4 py-2 border-b border-b/30 last:border-0">
                          <span className="w-5 text-right text-[10px] text-t-muted tabular-nums">{ti + 1}</span>
                          <div className="w-1.5 h-1.5 rounded-full bg-err shrink-0" />
                          <span className="text-[12px] text-t-secondary truncate">{t}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          /* Playlist selector */
          playlists.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-t-secondary text-sm">No playlists on device</div>
          ) : (
            <div className="card overflow-hidden">
              <label className="flex items-center gap-3 px-4 py-3 border-b border-b bg-bg-surface cursor-pointer">
                <input type="checkbox" checked={selected.size === playlists.length} onChange={toggleAll} className="accent-gf w-3.5 h-3.5" />
                <span className="text-[12px] font-semibold text-t-secondary">Select all ({playlists.length})</span>
              </label>
              {playlists.map((pl) => (
                <label key={pl.name} className="flex items-center gap-3 px-4 py-3 border-b border-b/30 last:border-0 hover:bg-bg-hover transition-colors cursor-pointer">
                  <input type="checkbox" checked={selected.has(pl.name)} onChange={() => togglePl(pl.name)} className="accent-gf w-3.5 h-3.5" />
                  <span className="flex-1 text-[13px] text-t">{pl.name}</span>
                  <span className="text-[11px] text-t-muted">{pl.track_count} tracks</span>
                </label>
              ))}
            </div>
          )
        )}
      </div>

      {error && <div className="p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err">{error}</div>}
    </div>
  );
}

function StatusDot({ status }: { status: PlexSyncResult["status"] }) {
  const color = status === "created" || status === "updated" ? "bg-ok" : status === "error" ? "bg-err" : "bg-t-muted";
  return <div className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} />;
}

function SyncLabel({ status }: { status: PlexSyncResult["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    created: { label: "Created", cls: "bg-ok-muted text-ok" },
    updated: { label: "Updated", cls: "bg-ok-muted text-ok" },
    error: { label: "Error", cls: "bg-err-muted text-err" },
    no_matches: { label: "No Matches", cls: "bg-bg-surface text-t-muted" },
    pending: { label: "Pending", cls: "bg-warn-muted text-warn" },
  };
  const c = map[status] || map.pending;
  return <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${c.cls}`}>{c.label}</span>;
}
