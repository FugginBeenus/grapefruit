import { useEffect, useState, useCallback } from "react";
import { soulseekSearch, soulseekDownload, type SoulseekCandidate } from "../api/soulseek";
import { useProgress } from "../hooks/useProgress";

function fmtSize(b: number) {
  return b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function quality(c: SoulseekCandidate): { label: string; tone: string } {
  if (["flac", "alac", "wav", "aiff", "ape", "wv"].includes(c.extension)) return { label: c.extension.toUpperCase(), tone: "cyan" };
  if (c.bitrate) return { label: `${c.bitrate}k`, tone: c.bitrate >= 320 ? "emer" : c.bitrate >= 192 ? "amber" : "ink3" };
  return { label: (c.extension || "?").toUpperCase(), tone: "violet" };
}

export function SoulseekSearchModal({ initialQuery, onClose }: { initialQuery: string; onClose: () => void }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SoulseekCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enqueued, setEnqueued] = useState<Set<string>>(new Set());
  const prog = useProgress("soulseek_search");

  const run = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true); setError(null); setResults(null);
    try { setResults(await soulseekSearch(q.trim())); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { run(initialQuery); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const download = async (c: SoulseekCandidate) => {
    try {
      await soulseekDownload(c.username, [{ filename: c.filename, size: c.size }]);
      setEnqueued((s) => new Set(s).add(c.filename));
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,.55)", backdropFilter: "blur(2px)" }} onClick={onClose}>
      <div className="rounded-2xl border border-line bg-panel w-[640px] max-w-[92vw] max-h-[85vh] overflow-hidden flex flex-col gf-in" style={{ boxShadow: "var(--shadow)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-line flex items-center gap-3">
          <div className="font-display text-[17px] font-bold text-ink">Find on Soulseek</div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-ink3 hover:text-ink text-lg leading-none">&times;</button>
        </div>
        <div className="px-5 py-3 border-b border-line flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run(query)} placeholder="Search Soulseek" className="input flex-1" autoFocus />
          <button onClick={() => run(query)} disabled={loading} className="btn btn-primary text-xs shrink-0">{loading ? "Searching..." : "Search"}</button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && <div className="px-5 py-6 font-mono text-[11px] text-ink3">{prog.message || "Searching the network..."}</div>}
          {error && <div className="px-5 py-4 text-[12px] text-err">{error}</div>}
          {results && results.length === 0 && !loading && <div className="px-5 py-6 text-[12px] text-ink3">No results. Try a simpler query — just artist and title.</div>}
          {results && results.map((c, i) => {
            const q = quality(c);
            const done = enqueued.has(c.filename);
            return (
              <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-line2 hover:bg-panel2 transition-colors">
                <span className="font-mono text-[8px] font-bold tracking-[.06em] px-1.5 py-1 rounded-md shrink-0" style={q.tone === "ink3" ? { background: "var(--panel2)", color: "var(--ink3)" } : { background: `var(--${q.tone}S)`, color: `var(--${q.tone})` }}>{q.label}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-ink truncate">{c.name}</div>
                  <div className="font-mono text-[9px] text-ink3 truncate">{c.username} · {fmtSize(c.size)}{c.has_slot ? "" : " · queued"}</div>
                </div>
                <button onClick={() => download(c)} disabled={done} className="btn btn-secondary text-[10px] py-1 px-2.5 shrink-0">{done ? "Queued" : "Download"}</button>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-2.5 border-t border-line font-mono text-[8px] text-ink3">DOWNLOADS LAND IN YOUR SOULSEEK FOLDER · SET IN SETTINGS</div>
      </div>
    </div>
  );
}
