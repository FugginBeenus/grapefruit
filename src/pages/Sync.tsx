import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useDeviceStore } from "../stores/deviceStore";
import { usePlexStore } from "../stores/plexStore";
import { rpcCall } from "../api/sidecar";
import { getAppConfig } from "../api/appConfig";
import { open } from "@tauri-apps/plugin-dialog";
import { ProgressBar } from "../components/ProgressBar";
import { useProgress } from "../hooks/useProgress";
import type { SyncPlan, PlexSyncResult, MetadataDiffResult, MetadataPullResult } from "../types/models";

const fmt = (b: number) => {
  if (!b) return "0 B";
  const gb = b / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`;
};

// Show the last couple of path segments for a readable, compact file label.
const shortPath = (p: string) => {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || p;
};

type Tab = "device" | "plex";
type SyncMode = "selective" | "full" | "delta";

/* ------------------------------------------------------------------ */
/*  Device Sync Tab                                                    */
/* ------------------------------------------------------------------ */

function PlanFileList({ title, paths, dotClass }: { title: string; paths: string[]; dotClass: string }) {
  const CAP = 500;
  return (
    <div className="mt-3">
      <p className="text-[10px] font-bold tracking-wide text-t-muted uppercase mb-2">
        {title} ({paths.length.toLocaleString()})
      </p>
      <div className="max-h-56 overflow-y-auto rounded-lg bg-bg-primary border">
        {paths.length === 0 ? (
          <p className="text-[11px] text-t-muted text-center py-3">None</p>
        ) : (
          <>
            {paths.slice(0, CAP).map((p, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 border-b border-b-[rgba(255,255,255,0.04)] last:border-0">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
                <span className="text-[11px] text-t-secondary truncate" title={p}>{shortPath(p)}</span>
              </div>
            ))}
            {paths.length > CAP && (
              <p className="text-[11px] text-t-muted text-center py-2">
                +{(paths.length - CAP).toLocaleString()} more
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DeviceSyncTab() {
  const { refreshLibrary } = useDeviceStore();
  const plexConfig = usePlexStore((s) => s.config);
  const plexConnected = usePlexStore((s) => s.connected);
  const loadPlexConfig = usePlexStore((s) => s.loadConfig);
  const [folder, setFolder] = useState("");
  const [mode, setMode] = useState<SyncMode>("selective");
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [showCopyList, setShowCopyList] = useState(false);
  const [showDeleteList, setShowDeleteList] = useState(false);
  const [computing, setComputing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [done, setDone] = useState(false);
  const [syncResult, setSyncResult] = useState<{ files_copied: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const computeProgress = useProgress("compute_sync_plan");
  const syncProgress = useProgress("execute_sync");

  // Metadata sync state
  const [metaDiff, setMetaDiff] = useState<MetadataDiffResult | null>(null);
  const [metaScanning, setMetaScanning] = useState(false);
  const [metaApplying, setMetaApplying] = useState(false);
  const [metaResult, setMetaResult] = useState<MetadataPullResult | null>(null);
  const [metaSelected, setMetaSelected] = useState<Set<string>>(new Set());
  const [pullArtwork, setPullArtwork] = useState(true);
  const metaDiffProgress = useProgress("plex_metadata_diff");
  const metaPullProgress = useProgress("plex_pull_metadata");

  // Default the master folder to the dedicated master-library path, falling
  // back to the Plex library path. Never overrides a folder the user typed.
  useEffect(() => { loadPlexConfig(); }, [loadPlexConfig]);
  useEffect(() => {
    (async () => {
      const cfg = await getAppConfig().catch(() => null);
      if (cfg?.master_library_path) {
        setFolder((f) => f || cfg.master_library_path);
      } else if (plexConfig?.music_library_path) {
        setFolder((f) => f || plexConfig.music_library_path);
      }
    })();
  }, [plexConfig?.music_library_path]);

  const checkMetadata = useCallback(async () => {
    setMetaScanning(true);
    setMetaDiff(null);
    setMetaResult(null);
    setError(null);
    try {
      const result = await rpcCall<MetadataDiffResult>("plex_metadata_diff", {});
      setMetaDiff(result);
      setMetaSelected(new Set(result.diffs.map((d) => d.path)));
    } catch (e) {
      setError(String(e));
    } finally {
      setMetaScanning(false);
    }
  }, []);

  const applyMetadata = useCallback(async () => {
    if (!metaDiff || metaSelected.size === 0) return;
    setMetaApplying(true);
    setError(null);
    try {
      const tracks = metaDiff.diffs
        .filter((d) => metaSelected.has(d.path))
        .map((d) => ({ path: d.path }));
      const result = await rpcCall<MetadataPullResult>("plex_pull_metadata", { tracks, pull_artwork: pullArtwork });
      setMetaResult(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setMetaApplying(false);
    }
  }, [metaDiff, metaSelected, pullArtwork]);

  const compute = async () => {
    setComputing(true);
    setError(null);
    setPlan(null);
    setShowCopyList(false);
    setShowDeleteList(false);
    setDone(false);
    setSyncResult(null);
    try {
      const result = await rpcCall<SyncPlan>("compute_sync_plan", { source_paths: [folder], mode });
      setPlan(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setComputing(false);
    }
  };

  const sync = async () => {
    if (!plan) return;
    setSyncing(true);
    setError(null);
    setDone(false);
    setSyncResult(null);
    try {
      const result = await rpcCall<{ files_copied: number; bytes_copied: number; errors: string[] }>(
        "execute_sync",
        { source_paths: [folder], copy_paths: plan._copy_paths, delete_paths: plan._delete_paths },
      );
      setSyncResult(result);
      setDone(true);
      await refreshLibrary();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  };

  const modeCards: { key: SyncMode; title: string; desc: string; color: string; borderColor: string; bgColor: string; icon: React.ReactNode }[] = [
    { key: "selective", title: "Selective", desc: "Add new files from master, keep everything on device", color: "text-cyan", borderColor: "border-cyan", bgColor: "bg-cyan-muted",
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg> },
    { key: "full", title: "Full Mirror", desc: "Mirror master to device — removes device-only files not in master", color: "text-violet", borderColor: "border-violet", bgColor: "bg-violet-muted",
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg> },
    { key: "delta", title: "Delta", desc: "Only copy files changed in master since last sync", color: "text-amber", borderColor: "border-amber", bgColor: "bg-amber-muted",
      icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-4.5L16.5 21m0 0L12 16.5m4.5 4.5V7.5" /></svg> },
  ];

  return (
    <div className="space-y-4">
      {/* Source Folder */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-t mb-3">Master Library</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="/Users/you/Music"
            className="input flex-1"
          />
          <button
            onClick={async () => {
              const selected = await open({ directory: true, multiple: false, title: "Select master library folder", defaultPath: folder || plexConfig?.music_library_path || undefined });
              if (selected) setFolder(typeof selected === "string" ? selected : selected);
            }}
            className="btn btn-secondary shrink-0 flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
            Browse
          </button>
        </div>
        <p className="text-xs text-t-muted mt-2">
          Your master library is the source of truth. Files sync one-way: master &rarr; device.
          {plexConfig?.music_library_path && folder === plexConfig.music_library_path && (
            <span className="text-emerald ml-1">Using path from Settings.</span>
          )}
        </p>
      </div>

      {/* Sync Mode */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-t mb-3">Sync Mode</h3>
        <div className="grid grid-cols-3 gap-3">
          {modeCards.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`p-4 rounded-lg border text-left transition-all ${
                mode === m.key
                  ? `${m.borderColor} ${m.bgColor}`
                  : "border-b hover:border-b-light hover:bg-bg-hover"
              }`}
            >
              <div className={`mb-2 ${mode === m.key ? m.color : "text-t-muted"}`}>{m.icon}</div>
              <p className={`text-sm font-medium ${mode === m.key ? m.color : "text-t"}`}>{m.title}</p>
              <p className="text-[11px] text-t-muted mt-1 leading-relaxed">{m.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Compute progress */}
      {computing && computeProgress.total > 0 && (
        <ProgressBar percent={computeProgress.percent} label="Analyzing files..." sublabel={`${computeProgress.current} / ${computeProgress.total}`} />
      )}

      {/* Plan results */}
      {plan && !done && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-t">Sync Plan</h3>
            {(plan.files_to_copy > 0 || plan.files_to_delete > 0) && (
              <span className="text-[11px] text-t-muted">Click a tile to review the files</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <button
              onClick={() => { if (plan.files_to_copy > 0) { setShowCopyList((v) => !v); setShowDeleteList(false); } }}
              disabled={plan.files_to_copy === 0}
              className={`bg-bg-primary rounded-lg p-4 text-center transition-all ${plan.files_to_copy > 0 ? "hover:bg-bg-hover cursor-pointer" : "cursor-default opacity-80"} ${showCopyList ? "ring-1 ring-ok/50" : ""}`}
            >
              <p className="text-2xl font-bold text-ok tabular-nums">{plan.files_to_copy}</p>
              <p className="text-[11px] text-t-muted mt-1">To Copy</p>
              <p className="text-[10px] text-t-muted">{fmt(plan.total_copy_bytes)}</p>
            </button>
            <button
              onClick={() => { if (plan.files_to_delete > 0) { setShowDeleteList((v) => !v); setShowCopyList(false); } }}
              disabled={plan.files_to_delete === 0}
              className={`bg-bg-primary rounded-lg p-4 text-center transition-all ${plan.files_to_delete > 0 ? "hover:bg-bg-hover cursor-pointer" : "cursor-default opacity-80"} ${showDeleteList ? "ring-1 ring-err/50" : ""}`}
            >
              <p className="text-2xl font-bold text-err tabular-nums">{plan.files_to_delete}</p>
              <p className="text-[11px] text-t-muted mt-1">To Remove</p>
              <p className="text-[10px] text-t-muted">{fmt(plan.total_delete_bytes)}</p>
            </button>
            <div className="bg-bg-primary rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-t-muted tabular-nums">{plan.files_unchanged}</p>
              <p className="text-[11px] text-t-muted mt-1">Unchanged</p>
            </div>
          </div>

          {showCopyList && <PlanFileList title="Files to copy" paths={plan._copy_paths} dotClass="bg-ok" />}
          {showDeleteList && <PlanFileList title="Files to remove" paths={plan._delete_paths} dotClass="bg-err" />}

          {!plan.fits_on_device && (
            <div className="p-3 rounded-lg bg-err-muted border border-err/20 text-[12px] text-err mt-4">
              Not enough space. Need {fmt(plan.shortfall_bytes)} more free.
            </div>
          )}
        </div>
      )}

      {/* Sync progress */}
      {syncing && (
        <ProgressBar
          percent={syncProgress.percent}
          label={syncProgress.message || "Syncing..."}
          sublabel={syncProgress.total > 0 ? `${syncProgress.current} / ${syncProgress.total}` : undefined}
        />
      )}

      {/* Done banner */}
      {done && syncResult && (
        <div className="card p-5 border-ok/20 bg-ok-muted">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-ok shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-[13px] font-semibold text-ok">
                Sync complete! Copied {syncResult.files_copied} file{syncResult.files_copied !== 1 ? "s" : ""}.
              </p>
              {syncResult.errors.length > 0 && (
                <p className="text-[12px] text-warn mt-1">
                  {syncResult.errors.length} error{syncResult.errors.length !== 1 ? "s" : ""}: {syncResult.errors.slice(0, 3).join(", ")}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Metadata Sync — available after file sync when Plex is connected */}
      {done && plexConnected && !metaDiff && !metaResult && (
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="icon-box icon-box-md icon-box-violet">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-t">Check Metadata</p>
                <p className="text-xs text-t-muted">Compare device tags against Plex and update differences.</p>
              </div>
            </div>
            <button onClick={checkMetadata} disabled={metaScanning} className="btn btn-secondary text-xs">
              {metaScanning ? "Scanning..." : "Check Now"}
            </button>
          </div>
        </div>
      )}

      {metaScanning && metaDiffProgress.total > 0 && (
        <ProgressBar
          percent={metaDiffProgress.percent}
          label={metaDiffProgress.message || "Comparing metadata..."}
          sublabel={`${metaDiffProgress.current} / ${metaDiffProgress.total}`}
        />
      )}

      {metaDiff && !metaResult && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b bg-bg-surface">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-t">Metadata Differences</span>
                <span className="badge badge-cyan">{metaDiff.matched_to_plex} matched</span>
                <span className="badge badge-amber">{metaDiff.tracks_with_diffs} differ</span>
                <span className="badge badge-emerald">{metaDiff.tracks_unchanged} ok</span>
              </div>
              {metaDiff.diffs.length > 0 && (
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-[12px] text-t-secondary cursor-pointer">
                    <input type="checkbox" checked={pullArtwork} onChange={(e) => setPullArtwork(e.target.checked)} className="accent-violet w-3.5 h-3.5" />
                    Pull artwork
                  </label>
                  <button onClick={applyMetadata} disabled={metaApplying || metaSelected.size === 0} className="btn btn-primary text-xs">
                    {metaApplying ? "Applying..." : `Update ${metaSelected.size} Track${metaSelected.size !== 1 ? "s" : ""}`}
                  </button>
                </div>
              )}
            </div>
          </div>

          {metaApplying && metaPullProgress.total > 0 && (
            <div className="px-4 py-3 border-b">
              <ProgressBar percent={metaPullProgress.percent} label={metaPullProgress.message || "Applying..."} sublabel={`${metaPullProgress.current} / ${metaPullProgress.total}`} />
            </div>
          )}

          {metaDiff.diffs.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-emerald font-medium">All metadata is up to date!</p>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {metaDiff.diffs.map((diff) => (
                <div key={diff.path} className="flex items-center gap-3 px-4 py-2 border-b border-b-[rgba(255,255,255,0.04)] last:border-0 hover:bg-bg-hover transition-colors">
                  <input
                    type="checkbox"
                    checked={metaSelected.has(diff.path)}
                    onChange={() => setMetaSelected((s) => { const n = new Set(s); n.has(diff.path) ? n.delete(diff.path) : n.add(diff.path); return n; })}
                    className="accent-violet w-3.5 h-3.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-t truncate">{diff.title}</p>
                    <p className="text-[11px] text-t-muted truncate">{diff.artist}{diff.album ? ` — ${diff.album}` : ""}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {diff.fields.slice(0, 3).map((f) => (
                      <span key={f.field} className="badge badge-amber">{f.field}</span>
                    ))}
                    {diff.fields.length > 3 && <span className="badge badge-info">+{diff.fields.length - 3}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {metaResult && (
        <div className="card p-5 border-emerald/20 bg-emerald-muted">
          <div className="flex items-center gap-3">
            <div className="icon-box icon-box-md icon-box-emerald">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-emerald">
                Updated metadata on {metaResult.updated} of {metaResult.total} tracks
              </p>
              {metaResult.errors.length > 0 && (
                <p className="text-[12px] text-amber mt-1">{metaResult.errors.length} error{metaResult.errors.length !== 1 ? "s" : ""}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-err/60 hover:text-err ml-3">&times;</button>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button onClick={compute} disabled={computing || !folder.trim()} className="btn btn-secondary">
          {computing ? "Computing..." : "Analyze"}
        </button>
        {plan && !done && (
          <button
            onClick={sync}
            disabled={syncing || (plan.files_to_copy === 0 && plan.files_to_delete === 0)}
            className="btn btn-primary"
          >
            {syncing ? "Syncing..." : "Start Sync"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Plex Sync Tab                                                      */
/* ------------------------------------------------------------------ */

function PlexSyncTab() {
  const navigate = useNavigate();
  const { playlists } = useDeviceStore();
  const { syncing, connected, serverName } = usePlexStore();
  const [results, setResults] = useState<PlexSyncResult[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const progress = useProgress("plex_sync");

  const togglePl = (n: string) =>
    setSelected((s) => { const next = new Set(s); next.has(n) ? next.delete(n) : next.add(n); return next; });

  const toggleAll = () =>
    setSelected((s) => s.size === playlists.length ? new Set() : new Set(playlists.map((p) => p.name)));

  const handleSync = async () => {
    setError(null);
    setResults([]);
    setExpandedIdx(null);
    try {
      const names = selected.size > 0 ? Array.from(selected) : undefined;
      await usePlexStore.getState().syncAll(names);
      setResults(usePlexStore.getState().syncResults);
    } catch (e) {
      setError(String(e));
    }
  };

  if (!connected) {
    return (
      <div className="card p-8 text-center">
        <div className="w-12 h-12 rounded-2xl bg-bg-surface flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.07-9.07l-1.757 1.757a4.5 4.5 0 00-6.364 6.364l4.5 4.5a4.5 4.5 0 007.244 1.242" />
          </svg>
        </div>
        <p className="text-sm font-medium text-t mb-1">Not connected to Plex</p>
        <p className="text-xs text-t-muted mb-4">Connect to your Plex server to sync playlists.</p>
        <button onClick={() => navigate("/settings")} className="btn btn-secondary text-xs">Go to Settings</button>
      </div>
    );
  }

  const totalMatched = results.reduce((s, r) => s + r.matched, 0);
  const totalMissing = results.reduce((s, r) => s + r.missing, 0);

  return (
    <div className="space-y-4">
      {/* Server status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-ok" />
          <span className="text-sm text-t-secondary">Connected to <span className="font-medium text-t">{serverName}</span></span>
        </div>
        <button onClick={handleSync} disabled={syncing || playlists.length === 0} className="btn btn-primary">
          {syncing ? "Syncing..." : selected.size > 0 ? `Sync ${selected.size} Playlist${selected.size !== 1 ? "s" : ""}` : "Sync All"}
        </button>
      </div>

      {/* Progress */}
      {syncing && (
        <ProgressBar
          percent={progress.percent}
          label={progress.message || "Syncing to Plex..."}
          sublabel={progress.total > 0 ? `${progress.current} / ${progress.total}` : undefined}
        />
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <h3 className="text-sm font-semibold text-t">Results</h3>
            <span className="text-xs text-ok font-medium">{totalMatched} matched</span>
            {totalMissing > 0 && <span className="text-xs text-err font-medium">{totalMissing} missing</span>}
            <div className="flex-1" />
            <button onClick={() => { setResults([]); setSelected(new Set()); }} className="btn btn-ghost text-xs">Clear</button>
          </div>
          {results.map((r, i) => (
            <div key={i} className="card overflow-hidden">
              <button
                onClick={() => r.missing > 0 && setExpandedIdx(expandedIdx === i ? null : i)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left"
              >
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  r.status === "created" || r.status === "updated" ? "bg-ok" : r.status === "error" ? "bg-err" : "bg-t-muted"
                }`} />
                <span className="flex-1 text-[13px] font-medium text-t truncate">{r.name}</span>
                <span className="text-[11px] text-ok tabular-nums">{r.matched} matched</span>
                {r.missing > 0 && <span className="text-[11px] text-err tabular-nums">{r.missing} missing</span>}
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${
                  r.status === "created" || r.status === "updated" ? "bg-ok-muted text-ok"
                    : r.status === "error" ? "bg-err-muted text-err"
                    : "bg-bg-surface text-t-muted"
                }`}>
                  {r.status === "no_matches" ? "No Matches" : r.status}
                </span>
                {r.missing > 0 && (
                  <svg className={`w-4 h-4 text-t-muted transition-transform ${expandedIdx === i ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>
              {expandedIdx === i && r.missing_tracks.length > 0 && (
                <div className="border-t border-b bg-bg-primary">
                  <div className="px-4 py-2 border-b">
                    <p className="text-[10px] font-bold tracking-wide text-t-muted uppercase">Missing Tracks ({r.missing_tracks.length})</p>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {r.missing_tracks.map((t, ti) => (
                      <div key={ti} className="flex items-center gap-3 px-4 py-2 border-b border-b-[rgba(255,255,255,0.04)] last:border-0">
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
      )}

      {/* Playlist selection */}
      {results.length === 0 && (
        playlists.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-t-muted">No playlists on device. Create playlists first to sync them to Plex.</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <label className="flex items-center gap-3 px-4 py-3 border-b bg-bg-surface cursor-pointer">
              <input type="checkbox" checked={selected.size === playlists.length} onChange={toggleAll} className="accent-gf w-3.5 h-3.5" />
              <span className="text-[12px] font-semibold text-t-secondary">Select all ({playlists.length})</span>
            </label>
            {playlists.map((pl) => (
              <label key={pl.name} className="flex items-center gap-3 px-4 py-3 border-b border-b-[rgba(255,255,255,0.04)] last:border-0 hover:bg-bg-hover transition-colors cursor-pointer">
                <input type="checkbox" checked={selected.has(pl.name)} onChange={() => togglePl(pl.name)} className="accent-gf w-3.5 h-3.5" />
                <span className="flex-1 text-[13px] text-t">{pl.name}</span>
                <span className="text-[11px] text-t-muted tabular-nums">{pl.track_count} tracks</span>
              </label>
            ))}
          </div>
        )
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-err/60 hover:text-err ml-3">&times;</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function Sync() {
  const { selectedDevice } = useDeviceStore();
  const [tab, setTab] = useState<Tab>("device");

  if (!selectedDevice) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center gap-7">
        <div className="relative">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(34, 211, 238, 0.06) 100%)", boxShadow: "0 0 48px rgba(16, 185, 129, 0.1), 0 8px 24px rgba(0,0,0,0.25)" }}>
            <svg className="w-10 h-10 text-emerald/50" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.015 4.356v4.992" />
            </svg>
          </div>
          <div className="absolute -inset-4 rounded-[28px] opacity-40" style={{ background: "radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, transparent 70%)" }} />
        </div>
        <div className="space-y-2 max-w-xs">
          <h2 className="text-lg font-semibold text-t">Sync Your Music</h2>
          <p className="text-sm text-t-muted leading-relaxed">Connect a device or local folder to sync files and push playlists to Plex.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6 pt-2">
        <h1 className="text-3xl font-bold text-t tracking-tight">Sync</h1>
        <p className="text-sm text-t-muted mt-1">Sync your master library to devices and push playlists to Plex</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-6 border-b mb-6">
        {([["device", "Device Sync", "border-emerald", "text-emerald"], ["plex", "Plex Sync", "border-violet", "text-violet"]] as [Tab, string, string, string][]).map(([key, label, borderCls, textCls]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              tab === key
                ? `${borderCls} ${textCls}`
                : "border-transparent text-t-muted hover:text-t-secondary"
            }`}
          >
            {key === "device" ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" /></svg>
            )}
            {label}
          </button>
        ))}
      </div>

      {tab === "device" ? <DeviceSyncTab /> : <PlexSyncTab />}
    </div>
  );
}
