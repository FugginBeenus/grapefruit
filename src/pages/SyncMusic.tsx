import { useState } from "react";
import { useDeviceStore } from "../stores/deviceStore";
import { rpcCall } from "../api/sidecar";
import { ProgressBar } from "../components/ProgressBar";
import { useProgress } from "../hooks/useProgress";
import type { SyncPlan } from "../types/models";

const fmt = (b: number) => {
  if (!b) return "0 B";
  const gb = b / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`;
};

export default function SyncMusic() {
  const { selectedDevice, refreshLibrary } = useDeviceStore();
  const [folder, setFolder] = useState("");
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [computing, setComputing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = useProgress("sync_execute");

  if (!selectedDevice) {
    return <EmptyState />;
  }

  const compute = async () => {
    setComputing(true); setError(null); setPlan(null);
    try {
      setPlan(await rpcCall<SyncPlan>("compute_sync_plan", { source_folder: folder, mount_point: selectedDevice.mount_point }));
    } catch (e) { setError(String(e)); } finally { setComputing(false); }
  };

  const sync = async () => {
    setSyncing(true); setError(null); setDone(false);
    try {
      await rpcCall("execute_sync_plan", { source_folder: folder, mount_point: selectedDevice.mount_point });
      setDone(true); await refreshLibrary();
    } catch (e) { setError(String(e)); } finally { setSyncing(false); }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-t">Sync Music</h1>
        <p className="text-[13px] text-t-secondary mt-1">Sync a local music folder to your device</p>
      </div>

      <div className="card p-6 space-y-4">
        <label className="block text-[13px] font-semibold text-t">Source Folder</label>
        <div className="flex gap-2">
          <input type="text" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/Users/you/Music" className="input flex-1" />
          <button onClick={compute} disabled={computing || !folder.trim()} className="btn btn-primary shrink-0">
            {computing ? "Computing..." : "Compute Plan"}
          </button>
        </div>
      </div>

      {plan && (
        <div className="card p-6 space-y-5">
          <h2 className="text-sm font-bold text-t">Sync Plan</h2>
          <div className="grid grid-cols-3 gap-6">
            <Stat label="To Copy" val={`${plan.files_to_copy.length}`} sub={fmt(plan.total_copy_bytes)} color="text-ok" />
            <Stat label="To Delete" val={`${plan.files_to_delete.length}`} sub={fmt(plan.total_delete_bytes)} color="text-err" />
            <Stat label="Unchanged" val={`${plan.files_unchanged.length}`} color="text-t-muted" />
          </div>
          {plan.total_copy_bytes > plan.device_free_bytes && (
            <div className="p-3 rounded-lg bg-err-muted text-[12px] text-err">
              Not enough space! Need {fmt(plan.total_copy_bytes - plan.device_free_bytes)} more.
            </div>
          )}
          <button onClick={sync} disabled={syncing || plan.files_to_copy.length === 0} className="btn btn-primary">
            {syncing ? "Syncing..." : "Start Sync"}
          </button>
        </div>
      )}

      {syncing && (
        <ProgressBar percent={progress.percent} label={progress.message || "Syncing..."} sublabel={progress.total > 0 ? `${progress.current} / ${progress.total}` : undefined} />
      )}

      {done && (
        <div className="p-4 rounded-xl bg-ok-muted border border-ok/20 text-[13px] text-ok">
          Sync complete! Device library has been refreshed.
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err">{error}</div>
      )}
    </div>
  );
}

function Stat({ label, val, sub, color }: { label: string; val: string; sub?: string; color: string }) {
  return (
    <div>
      <p className="text-[10px] text-t-muted uppercase tracking-wide font-semibold">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{val}</p>
      {sub && <p className="text-[11px] text-t-muted">{sub}</p>}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center gap-4">
      <div className="w-14 h-14 rounded-2xl bg-bg-surface flex items-center justify-center">
        <svg className="w-7 h-7 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.015 4.356v4.992" />
        </svg>
      </div>
      <p className="text-t-secondary text-sm">Connect a device to sync music</p>
    </div>
  );
}
