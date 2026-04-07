import { useState } from "react";
import { useDeviceStore } from "../stores/deviceStore";
import { rpcCall } from "../api/sidecar";
import type { DuplicateGroup } from "../types/models";

export default function Duplicates() {
  const { selectedDevice, tracks } = useDeviceStore();
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [scanning, setScanning] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [toDelete, setToDelete] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  if (!selectedDevice) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-bg-surface flex items-center justify-center">
          <svg className="w-7 h-7 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
          </svg>
        </div>
        <p className="text-t-secondary text-sm">Connect a device to find duplicates</p>
      </div>
    );
  }

  const scan = async () => {
    setScanning(true); setError(null); setToDelete(new Set());
    try { setGroups(await rpcCall<DuplicateGroup[]>("find_duplicates", {})); }
    catch (e) { setError(String(e)); }
    finally { setScanning(false); }
  };

  const toggle = (i: number) => setExpanded(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const toggleDel = (p: string) => setToDelete(s => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] gap-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-t">Duplicates</h1>
          <p className="text-[13px] text-t-secondary mt-1">
            {groups.length > 0 ? `${groups.length} group${groups.length !== 1 ? "s" : ""} found` : `${tracks.length.toLocaleString()} tracks loaded`}
          </p>
        </div>
        <button onClick={scan} disabled={scanning || tracks.length === 0} className="btn btn-secondary">
          {scanning ? "Scanning..." : "Find Duplicates"}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
        {groups.map((g, i) => (
          <div key={i} className="card overflow-hidden">
            <button onClick={() => toggle(i)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover transition-colors text-left">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-t truncate">{g.title}</p>
                <p className="text-[11px] text-t-muted truncate">{g.artist}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[12px] text-warn font-semibold">{g.copies.length} copies</span>
                <svg className={`w-4 h-4 text-t-muted transition-transform ${expanded.has(i) ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>
            {expanded.has(i) && (
              <div className="border-t border-b">
                {g.copies.map((c, ci) => (
                  <label key={ci} className="flex items-center gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors cursor-pointer">
                    <input type="checkbox" checked={toDelete.has(c.file_path)} onChange={() => toggleDel(c.file_path)} className="accent-gf w-3.5 h-3.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-t truncate">{c.relative_path}</p>
                      <p className="text-[10px] text-t-muted">
                        {c.format?.toUpperCase()}{c.file_size ? ` \u2014 ${(c.file_size / 1024 / 1024).toFixed(1)} MB` : ""}
                      </p>
                    </div>
                    {ci === 0 && <span className="text-[10px] text-ok font-bold shrink-0">KEEP</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}

        {groups.length === 0 && !scanning && tracks.length > 0 && (
          <div className="flex items-center justify-center h-40 text-t-secondary text-sm">Click "Find Duplicates" to scan</div>
        )}
      </div>

      {toDelete.size > 0 && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-err-muted border border-err/20">
          <span className="text-[13px] text-err font-medium">{toDelete.size} file{toDelete.size !== 1 ? "s" : ""} selected</span>
          <button className="btn btn-danger">Delete Selected</button>
        </div>
      )}

      {error && <div className="p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err">{error}</div>}
    </div>
  );
}
