import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useDeviceStore } from "../stores/deviceStore";
import { usePlexStore } from "../stores/plexStore";
import { rpcCall } from "../api/sidecar";
import { getAppConfig } from "../api/appConfig";
import { open } from "@tauri-apps/plugin-dialog";
import { ProgressBar } from "../components/ProgressBar";
import { useProgress } from "../hooks/useProgress";
import { plexListPlaylists, type PlexPlaylist } from "../api/plex";
import type { SyncPlan, PlexSyncResult, MetadataDiffResult, MetadataPullResult } from "../types/models";

const fmt = (b: number) => {
  if (!b) return "0 B";
  const gb = b / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`;
};
const shortPath = (p: string) => {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || p;
};

type Tab = "device" | "plex";
type SyncMode = "selective" | "full" | "delta";

function PlanFileList({ title, subtitle, paths, op }: { title: string; subtitle: string; paths: string[]; op: string }) {
  const CAP = 300;
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 flex items-center gap-3 panel2 border-b border-line">
        <div className="text-[13px] font-bold text-ink">{title}</div>
        <div className="font-mono text-[9px] text-ink3 flex-1">{subtitle}</div>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {paths.length === 0 ? (
          <p className="font-mono text-[10px] text-ink3 text-center py-4">NONE</p>
        ) : (
          <>
            {paths.slice(0, CAP).map((p, i) => (
              <div key={i} className="grid items-center gap-3.5 px-5 py-2.5 border-b border-line2" style={{ gridTemplateColumns: "60px minmax(0,1fr)" }}>
                <div className="font-mono text-[9px]" style={{ color: op === "COPY" ? "var(--emer)" : "var(--err)" }}>{op}</div>
                <div className="font-mono text-[11px] text-ink truncate" title={p}>{shortPath(p)}</div>
              </div>
            ))}
            {paths.length > CAP && <p className="font-mono text-[9px] text-ink3 px-5 py-2.5">+ {(paths.length - CAP).toLocaleString()} MORE</p>}
          </>
        )}
      </div>
    </div>
  );
}

function DeviceSyncTab() {
  const { ipod, refreshLibrary } = useDeviceStore();
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

  const [metaDiff, setMetaDiff] = useState<MetadataDiffResult | null>(null);
  const [metaScanning, setMetaScanning] = useState(false);
  const [metaApplying, setMetaApplying] = useState(false);
  const [metaResult, setMetaResult] = useState<MetadataPullResult | null>(null);
  const [metaSelected, setMetaSelected] = useState<Set<string>>(new Set());
  const [pullArtwork, setPullArtwork] = useState(true);
  const metaDiffProgress = useProgress("plex_metadata_diff");
  const metaPullProgress = useProgress("plex_pull_metadata");

  useEffect(() => { loadPlexConfig(); }, [loadPlexConfig]);
  useEffect(() => {
    (async () => {
      const cfg = await getAppConfig().catch(() => null);
      if (cfg?.master_library_path) setFolder((f) => f || cfg.master_library_path);
      else if (plexConfig?.music_library_path) setFolder((f) => f || plexConfig.music_library_path);
    })();
  }, [plexConfig?.music_library_path]);

  const checkMetadata = useCallback(async () => {
    setMetaScanning(true); setMetaDiff(null); setMetaResult(null); setError(null);
    try {
      const result = await rpcCall<MetadataDiffResult>("plex_metadata_diff", {});
      setMetaDiff(result);
      setMetaSelected(new Set(result.diffs.map((d) => d.path)));
    } catch (e) { setError(String(e)); } finally { setMetaScanning(false); }
  }, []);

  const applyMetadata = useCallback(async () => {
    if (!metaDiff || metaSelected.size === 0) return;
    setMetaApplying(true); setError(null);
    try {
      const tracks = metaDiff.diffs.filter((d) => metaSelected.has(d.path)).map((d) => ({ path: d.path }));
      const result = await rpcCall<MetadataPullResult>("plex_pull_metadata", { tracks, pull_artwork: pullArtwork });
      setMetaResult(result);
    } catch (e) { setError(String(e)); } finally { setMetaApplying(false); }
  }, [metaDiff, metaSelected, pullArtwork]);

  const compute = async () => {
    setComputing(true); setError(null); setPlan(null); setShowCopyList(false); setShowDeleteList(false); setDone(false); setSyncResult(null);
    try {
      const result = await rpcCall<SyncPlan>("compute_sync_plan", { source_paths: [folder], mode });
      setPlan(result);
    } catch (e) { setError(String(e)); } finally { setComputing(false); }
  };

  const sync = async () => {
    if (!plan) return;
    setSyncing(true); setError(null); setDone(false); setSyncResult(null);
    try {
      const result = await rpcCall<{ files_copied: number; bytes_copied: number; errors: string[] }>("execute_sync", { source_paths: [folder], copy_paths: plan._copy_paths, delete_paths: plan._delete_paths });
      setSyncResult(result); setDone(true); await refreshLibrary();
    } catch (e) { setError(String(e)); } finally { setSyncing(false); }
  };

  const modes: { key: SyncMode; icon: string; tone: string; title: string; desc: string }[] = [
    { key: "selective", icon: "+", tone: "cyan", title: "Selective", desc: "Add new files from master, keep everything already on device." },
    { key: "full", icon: "=", tone: "violet", title: "Full Mirror", desc: "Mirror master to device — removes device-only files not in master." },
    { key: "delta", icon: "Δ", tone: "amber", title: "Delta", desc: "Only copy files changed in master since the last sync." },
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      {/* master + target + mode */}
      <div className="card p-6 flex flex-col gap-5 gf-in">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex flex-col gap-[7px] flex-1 min-w-[260px]">
            <div className="font-mono text-[9px] tracking-[.14em] text-ink3">MASTER LIBRARY</div>
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl panel2">
              <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/Volumes/Music"
                className="font-mono text-[11px] text-ink flex-1 min-w-0 bg-transparent outline-none" />
              <button onClick={async () => {
                const sel = await open({ directory: true, multiple: false, title: "Select master library folder", defaultPath: folder || plexConfig?.music_library_path || undefined });
                if (sel) setFolder(typeof sel === "string" ? sel : String(sel));
              }} className="text-[11px] font-bold text-brand shrink-0">Change</button>
            </div>
          </div>
          <div className="flex flex-col gap-[7px]">
            <div className="font-mono text-[9px] tracking-[.14em] text-ink3">TARGET DEVICE</div>
            {ipod ? (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-line" style={{ background: "var(--cyanS)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--cyan)" }} />
                <span className="text-[12px] font-bold" style={{ color: "var(--cyan)" }}>{ipod.label || "Device"} · {(ipod.firmware || "").toUpperCase()}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-line panel2">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--ink3)" }} />
                <span className="text-[12px] font-medium text-ink3">No device — connect one in the sidebar</span>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {modes.map((m) => {
            const on = mode === m.key;
            return (
              <button key={m.key} onClick={() => setMode(m.key)}
                className="p-4 rounded-[15px] panel2 flex flex-col gap-2.5 text-left transition-colors"
                style={on ? { borderColor: "var(--brandLine)", boxShadow: "inset 0 0 0 1px var(--brandLine)" } : undefined}>
                <div className="flex items-center gap-2.5">
                  <span className="w-7 h-7 rounded-[9px] flex items-center justify-center font-mono text-[11px] font-semibold" style={{ background: `var(--${m.tone}S)`, color: `var(--${m.tone})` }}>{m.icon}</span>
                  <span className="text-[13px] font-bold flex-1 text-ink">{m.title}</span>
                  {on && <span className="badge badge-brand">Active</span>}
                </div>
                <div className="text-[12px] leading-[1.55] text-ink2">{m.desc}</div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3.5 flex-wrap">
          <button onClick={compute} disabled={computing || !folder.trim() || !ipod} className="btn btn-secondary">{computing ? "Analyzing..." : plan ? "Re-analyze" : "Analyze"}</button>
          {plan && <span className="font-mono text-[9px] text-ink3">PLAN BUILT · NOTHING HAS BEEN WRITTEN</span>}
        </div>
      </div>

      {computing && (
        <div className="card p-5">
          <ProgressBar percent={computeProgress.percent} indeterminate={computeProgress.total === 0} label="Analyzing files..." sublabel={computeProgress.total > 0 ? `${computeProgress.current} / ${computeProgress.total}` : undefined} />
        </div>
      )}

      {/* sync plan */}
      {plan && !done && (
        <div className="flex flex-col gap-3 gf-in">
          <div className="flex items-baseline gap-3 flex-wrap">
            <div className="text-[21px] font-bold tracking-[-0.025em] text-ink">Sync plan</div>
            {(plan.files_to_copy > 0 || plan.files_to_delete > 0) && <div className="font-mono text-[9px] tracking-[.1em] text-ink3">CLICK A TILE TO SEE THE FILES</div>}
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
            <button onClick={() => { if (plan.files_to_copy > 0) { setShowCopyList((v) => !v); setShowDeleteList(false); } }} disabled={plan.files_to_copy === 0}
              className="card p-5 flex flex-col gap-2.5 text-left transition-colors disabled:cursor-default"
              style={showCopyList ? { borderColor: "var(--brandLine)", boxShadow: "inset 0 0 0 1px var(--brandLine), var(--shadow)" } : undefined}>
              <div className="font-mono text-[9px] tracking-[.14em]" style={{ color: "var(--emer)" }}>TO COPY</div>
              <div className="text-[46px] font-display font-extrabold leading-[0.9] tracking-[-0.04em] text-ink tabular-nums">{plan.files_to_copy}</div>
              <div className="font-mono text-[9px] text-ink2">{fmt(plan.total_copy_bytes)}</div>
            </button>
            <button onClick={() => { if (plan.files_to_delete > 0) { setShowDeleteList((v) => !v); setShowCopyList(false); } }} disabled={plan.files_to_delete === 0}
              className="card p-5 flex flex-col gap-2.5 text-left transition-colors disabled:cursor-default"
              style={showDeleteList ? { borderColor: "var(--brandLine)", boxShadow: "inset 0 0 0 1px var(--brandLine), var(--shadow)" } : undefined}>
              <div className="font-mono text-[9px] tracking-[.14em]" style={{ color: "var(--err)" }}>TO REMOVE</div>
              <div className="text-[46px] font-display font-extrabold leading-[0.9] tracking-[-0.04em] text-ink tabular-nums">{plan.files_to_delete}</div>
              <div className="font-mono text-[9px] text-ink2">{plan.files_to_delete === 0 ? "MODE KEEPS EXTRAS" : fmt(plan.total_delete_bytes)}</div>
            </button>
            <div className="card p-5 flex flex-col gap-2.5">
              <div className="font-mono text-[9px] tracking-[.14em] text-ink3">UNCHANGED</div>
              <div className="text-[46px] font-display font-extrabold leading-[0.9] tracking-[-0.04em] text-ink2 tabular-nums">{plan.files_unchanged}</div>
              <div className="font-mono text-[9px] text-ink3">ALREADY THERE</div>
            </div>
          </div>

          {showCopyList && <PlanFileList title={`${plan.files_to_copy} files to copy`} subtitle={`MASTER → DEVICE · ${fmt(plan.total_copy_bytes)}`} paths={plan._copy_paths} op="COPY" />}
          {showDeleteList && <PlanFileList title={`${plan.files_to_delete} files to remove`} subtitle={fmt(plan.total_delete_bytes)} paths={plan._delete_paths} op="REMOVE" />}

          {!plan.fits_on_device && (
            <div className="p-4 rounded-[15px] border border-line flex items-center gap-3" style={{ background: "var(--amberS)" }}>
              <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0" style={{ background: "var(--amber)", color: "var(--bg)" }}>!</div>
              <div className="text-[13px] font-bold" style={{ color: "var(--amber)" }}>Not enough space. Need {fmt(plan.shortfall_bytes)} more free.</div>
            </div>
          )}

          <div className="card p-5 flex items-center gap-3.5 flex-wrap">
            <div className="flex flex-col gap-2 flex-1 min-w-[240px]">
              <div className="flex justify-between font-mono text-[9px] text-ink3">
                <div>{syncing ? (syncProgress.message || "SYNCING") : `READY · ${plan.files_to_copy + plan.files_to_delete} OPERATIONS QUEUED`}</div>
                <div>{syncing && syncProgress.total > 0 ? `${syncProgress.percent}%` : "0%"}</div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden relative" style={{ background: "var(--line)" }}>
                {syncing
                  ? (syncProgress.total > 0
                    ? <div className="h-full rounded-full" style={{ width: `${syncProgress.percent}%`, background: "var(--brand)" }} />
                    : <div className="absolute inset-0 w-[28%] rounded-full" style={{ background: "linear-gradient(90deg, transparent, var(--brand), transparent)", animation: "gfSweep 1.9s ease-in-out infinite" }} />)
                  : null}
              </div>
            </div>
            <button onClick={sync} disabled={syncing || (plan.files_to_copy === 0 && plan.files_to_delete === 0)} className="btn btn-primary">{syncing ? "Syncing..." : "Start sync"}</button>
          </div>
        </div>
      )}

      {done && syncResult && (
        <div className="card p-5 gf-in" style={{ background: "var(--emerS)" }}>
          <p className="text-[13px] font-semibold" style={{ color: "var(--emer)" }}>Sync complete. Copied {syncResult.files_copied} file{syncResult.files_copied !== 1 ? "s" : ""}.</p>
          {syncResult.errors.length > 0 && <p className="text-[12px] mt-1" style={{ color: "var(--amber)" }}>{syncResult.errors.length} error{syncResult.errors.length !== 1 ? "s" : ""}: {syncResult.errors.slice(0, 3).join(", ")}</p>}
        </div>
      )}

      {/* Metadata (Plex) */}
      {done && plexConnected && !metaDiff && !metaResult && (
        <div className="card p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="icon-box icon-box-md icon-box-violet font-mono text-[11px]">M</div>
            <div>
              <p className="text-[13px] font-semibold text-ink">Check metadata against Plex</p>
              <p className="text-[12px] text-ink2">Compare device tags with Plex and apply differences.</p>
            </div>
          </div>
          <button onClick={checkMetadata} disabled={metaScanning} className="btn btn-secondary text-xs">{metaScanning ? "Scanning..." : "Check now"}</button>
        </div>
      )}

      {metaScanning && metaDiffProgress.total > 0 && (
        <div className="card p-5"><ProgressBar percent={metaDiffProgress.percent} label={metaDiffProgress.message || "Comparing metadata..."} sublabel={`${metaDiffProgress.current} / ${metaDiffProgress.total}`} /></div>
      )}

      {metaDiff && !metaResult && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-line panel2 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-[13px] font-bold text-ink">Metadata differences</span>
              <span className="badge badge-cyan">{metaDiff.matched_to_plex} matched</span>
              <span className="badge badge-amber">{metaDiff.tracks_with_diffs} differ</span>
              <span className="badge badge-emerald">{metaDiff.tracks_unchanged} ok</span>
            </div>
            {metaDiff.diffs.length > 0 && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[12px] text-ink2 cursor-pointer">
                  <input type="checkbox" checked={pullArtwork} onChange={(e) => setPullArtwork(e.target.checked)} className="w-3.5 h-3.5" style={{ accentColor: "var(--violet)" }} /> Pull artwork
                </label>
                <button onClick={applyMetadata} disabled={metaApplying || metaSelected.size === 0} className="btn btn-primary text-xs">{metaApplying ? "Applying..." : `Update ${metaSelected.size}`}</button>
              </div>
            )}
          </div>
          {metaApplying && metaPullProgress.total > 0 && <div className="px-5 py-3 border-b border-line"><ProgressBar percent={metaPullProgress.percent} label={metaPullProgress.message || "Applying..."} sublabel={`${metaPullProgress.current} / ${metaPullProgress.total}`} /></div>}
          {metaDiff.diffs.length === 0 ? (
            <p className="p-6 text-center text-[13px] font-medium" style={{ color: "var(--emer)" }}>All metadata is up to date.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {metaDiff.diffs.map((diff) => (
                <div key={diff.path} className="flex items-center gap-3 px-5 py-2.5 border-b border-line2 hover:bg-panel2 transition-colors">
                  <input type="checkbox" checked={metaSelected.has(diff.path)} onChange={() => setMetaSelected((s) => { const n = new Set(s); n.has(diff.path) ? n.delete(diff.path) : n.add(diff.path); return n; })} className="w-3.5 h-3.5 shrink-0" style={{ accentColor: "var(--violet)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">{diff.title}</p>
                    <p className="text-[11px] text-ink3 truncate">{diff.artist}{diff.album ? ` — ${diff.album}` : ""}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {diff.fields.slice(0, 3).map((f) => <span key={f.field} className="badge badge-amber">{f.field}</span>)}
                    {diff.fields.length > 3 && <span className="badge badge-cyan">+{diff.fields.length - 3}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {metaResult && (
        <div className="card p-5 gf-in" style={{ background: "var(--emerS)" }}>
          <p className="text-[13px] font-semibold" style={{ color: "var(--emer)" }}>Updated metadata on {metaResult.updated} of {metaResult.total} tracks.</p>
          {metaResult.errors.length > 0 && <p className="text-[12px] mt-1" style={{ color: "var(--amber)" }}>{metaResult.errors.length} error{metaResult.errors.length !== 1 ? "s" : ""}</p>}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-line flex items-center justify-between" style={{ background: "var(--errS)" }}>
          <span className="text-[13px] text-err">{error}</span>
          <button onClick={() => setError(null)} className="text-err ml-3">×</button>
        </div>
      )}
    </div>
  );
}

/* ── Plex Sync ─────────────────────────────────── */
function PlexSyncTab() {
  const navigate = useNavigate();
  const { playlists } = useDeviceStore();
  const { syncing, connected, serverName } = usePlexStore();
  const [results, setResults] = useState<PlexSyncResult[]>([]);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [plexPls, setPlexPls] = useState<PlexPlaylist[] | null>(null);
  const [loadingPls, setLoadingPls] = useState(false);
  const progress = useProgress("plex_sync");

  const viewPlexPlaylists = async () => {
    setLoadingPls(true);
    setError(null);
    try {
      setPlexPls(await plexListPlaylists());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingPls(false);
    }
  };

  const togglePl = (n: string) => setSelected((s) => { const next = new Set(s); next.has(n) ? next.delete(n) : next.add(n); return next; });
  const toggleAll = () => setSelected((s) => s.size === playlists.length ? new Set() : new Set(playlists.map((p) => p.name)));

  const handleSync = async () => {
    setError(null); setResults([]); setExpandedIdx(null);
    try {
      const names = selected.size > 0 ? Array.from(selected) : undefined;
      await usePlexStore.getState().syncAll(names);
      setResults(usePlexStore.getState().syncResults);
    } catch (e) { setError(String(e)); }
  };

  if (!connected) {
    return (
      <div className="card p-8 text-center gf-in">
        <p className="text-[13px] font-medium text-ink mb-1">Not connected to Plex</p>
        <p className="text-[12px] text-ink3 mb-4">Connect to your Plex server to sync playlists.</p>
        <button onClick={() => navigate("/settings")} className="btn btn-secondary text-xs">Go to settings</button>
      </div>
    );
  }

  const totalMatched = results.reduce((s, r) => s + r.matched, 0);
  const totalMissing = results.reduce((s, r) => s + r.missing, 0);

  return (
    <div className="flex flex-col gap-4 gf-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--emer)" }} />
          <span className="text-[13px] text-ink2">Connected to <span className="font-semibold text-ink">{serverName}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={viewPlexPlaylists} disabled={loadingPls} className="btn btn-secondary text-xs">{loadingPls ? "Loading..." : "View on Plex"}</button>
          <button onClick={handleSync} disabled={syncing || playlists.length === 0} className="btn btn-primary">{syncing ? "Syncing..." : selected.size > 0 ? `Sync ${selected.size}` : "Sync all"}</button>
        </div>
      </div>

      {plexPls && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 panel2 border-b border-line">
            <span className="text-[13px] font-bold text-ink">On Plex</span>
            <span className="font-mono text-[10px] text-ink3">{plexPls.length} PLAYLIST{plexPls.length !== 1 ? "S" : ""}</span>
            <div className="flex-1" />
            <button onClick={() => setPlexPls(null)} className="btn btn-ghost text-xs">Hide</button>
          </div>
          {plexPls.length === 0 ? (
            <div className="px-5 py-4 text-[12px] text-ink3">No audio playlists on Plex yet.</div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {plexPls.map((p) => (
                <div key={p.ratingKey} className="flex items-center gap-3 px-5 py-2.5 border-b border-line2 last:border-0">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--cyan)" }} />
                  <span className="flex-1 text-[13px] text-ink truncate">{p.title}</span>
                  <span className="font-mono text-[10px] text-ink3">{p.leafCount} TRACKS</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {syncing && <div className="card p-5"><ProgressBar percent={progress.percent} label={progress.message || "Syncing to Plex..."} sublabel={progress.total > 0 ? `${progress.current} / ${progress.total}` : undefined} /></div>}

      {results.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <h3 className="text-[13px] font-bold text-ink">Results</h3>
            <span className="font-mono text-[10px]" style={{ color: "var(--emer)" }}>{totalMatched} MATCHED</span>
            {totalMissing > 0 && <span className="font-mono text-[10px]" style={{ color: "var(--err)" }}>{totalMissing} MISSING</span>}
            <div className="flex-1" />
            <button onClick={() => { setResults([]); setSelected(new Set()); }} className="btn btn-ghost text-xs">Clear</button>
          </div>
          {totalMatched === 0 && (
            <div className="p-3 rounded-xl text-[12px] leading-relaxed" style={{ background: "var(--amberS)", color: "var(--amber)" }}>
              Nothing matched on Plex. Plex has to index the same audio files as this library — confirm your Plex music library points at the same folder and has been scanned, then try again.
            </div>
          )}
          {results.map((r, i) => (
            <div key={i} className="card overflow-hidden">
              <button onClick={() => r.missing > 0 && setExpandedIdx(expandedIdx === i ? null : i)} className="w-full flex items-center gap-3 px-5 py-3 hover:bg-panel2 transition-colors text-left">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.status === "created" || r.status === "updated" ? "var(--emer)" : r.status === "error" ? "var(--err)" : "var(--ink3)" }} />
                <span className="flex-1 text-[13px] font-medium text-ink truncate">{r.name}</span>
                <span className="font-mono text-[10px]" style={{ color: "var(--emer)" }}>{r.matched} MATCHED</span>
                {r.missing > 0 && <span className="font-mono text-[10px]" style={{ color: "var(--err)" }}>{r.missing} MISSING</span>}
                <span className={`badge ${r.status === "created" || r.status === "updated" ? "badge-emerald" : r.status === "error" ? "badge-err" : "badge-cyan"}`}>{r.status === "no_matches" ? "No matches" : r.status}</span>
              </button>
              {expandedIdx === i && r.missing_tracks.length > 0 && (
                <div className="border-t border-line panel2">
                  <div className="px-5 py-2 border-b border-line font-mono text-[9px] font-semibold tracking-[.14em] text-ink3">MISSING TRACKS ({r.missing_tracks.length})</div>
                  <div className="max-h-48 overflow-y-auto">
                    {r.missing_tracks.map((t, ti) => (
                      <div key={ti} className="flex items-center gap-3 px-5 py-2 border-b border-line2">
                        <span className="w-5 text-right font-mono text-[9px] text-ink3">{ti + 1}</span>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--err)" }} />
                        <span className="text-[12px] text-ink2 truncate">{t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {results.length === 0 && (
        playlists.length === 0 ? (
          <div className="card p-8 text-center"><p className="text-[13px] text-ink3">No playlists on device. Create playlists first to sync them to Plex.</p></div>
        ) : (
          <div className="card overflow-hidden">
            <label className="flex items-center gap-3 px-5 py-3 border-b border-line panel2 cursor-pointer">
              <input type="checkbox" checked={selected.size === playlists.length} onChange={toggleAll} className="w-3.5 h-3.5" style={{ accentColor: "var(--brand)" }} />
              <span className="text-[12px] font-semibold text-ink2">Select all ({playlists.length})</span>
            </label>
            {playlists.map((pl) => (
              <label key={pl.name} className="flex items-center gap-3 px-5 py-3 border-b border-line2 hover:bg-panel2 transition-colors cursor-pointer">
                <input type="checkbox" checked={selected.has(pl.name)} onChange={() => togglePl(pl.name)} className="w-3.5 h-3.5" style={{ accentColor: "var(--brand)" }} />
                <span className="flex-1 text-[13px] text-ink">{pl.name}</span>
                <span className="font-mono text-[10px] text-ink3">{pl.track_count} TRACKS</span>
              </label>
            ))}
          </div>
        )
      )}

      {error && (
        <div className="p-4 rounded-xl border border-line flex items-center justify-between" style={{ background: "var(--errS)" }}>
          <span className="text-[13px] text-err">{error}</span>
          <button onClick={() => setError(null)} className="text-err ml-3">×</button>
        </div>
      )}
    </div>
  );
}

export default function Sync() {
  const { selectedDevice, ipod } = useDeviceStore();
  const [tab, setTab] = useState<Tab>("device");

  if (!selectedDevice && !ipod) {
    return (
      <div className="card gf-in p-[40px] flex flex-col gap-4 max-w-[560px]">
        <div className="font-mono text-[9px] tracking-[.18em] text-brand">NO TARGET</div>
        <div className="text-[32px] font-display font-extrabold tracking-[-0.035em] leading-tight text-ink">Connect a device or folder to sync.</div>
        <p className="text-[14px] leading-[1.6] text-ink2">Use the sidebar to connect a local folder or an iPod, then Grapefruit can mirror your master library and push playlists to Plex.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[18px] max-w-[1600px]">
      <div className="flex gap-1.5 p-1 rounded-full panel2 w-fit">
        {([["device", "Device Sync"], ["plex", "Plex Sync"]] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className="px-[18px] py-2 rounded-full text-[12px] transition-all"
            style={tab === key ? { background: "var(--panel)", fontWeight: 700, color: "var(--ink)", boxShadow: "var(--shadow)" } : { fontWeight: 500, color: "var(--ink2)" }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "device" ? <DeviceSyncTab /> : <PlexSyncTab />}
    </div>
  );
}
