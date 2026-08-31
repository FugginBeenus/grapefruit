import React, { useState, useCallback, useMemo } from "react";
import { useDeviceStore } from "../stores/deviceStore";
import { rpcCall } from "../api/sidecar";
import { ProgressBar } from "../components/ProgressBar";
import { useProgress } from "../hooks/useProgress";
import type {
  HealthCheckResult,
  DuplicateGroup,
  OrganizeResult,
} from "../types/models";

type ToolTab = "health" | "duplicates" | "organize";

function IssueIcon({ d }: { d: string }) {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

/* ================================================================ */
/*  Library Health Check                                              */
/* ================================================================ */

function HealthCheckTab() {
  const [result, setResult] = useState<HealthCheckResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const progress = useProgress("library_health_check");

  const runCheck = useCallback(async () => {
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const res = await rpcCall<HealthCheckResult>("library_health_check", {});
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  const issueCategories = result ? [
    { key: "missing_title", label: "Missing Title", count: result.summary.missing_title, color: "err", icon: <IssueIcon d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h10.5" /> },
    { key: "missing_artist", label: "Missing Artist", count: result.summary.missing_artist, color: "pink", icon: <IssueIcon d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /> },
    { key: "missing_album", label: "Missing Album", count: result.summary.missing_album, color: "violet", icon: <IssueIcon d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" /> },
    { key: "no_artwork", label: "No Artwork", count: result.summary.no_artwork, color: "amber", icon: <IssueIcon d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25z" /> },
    { key: "broken_files", label: "Broken Files", count: result.summary.broken_files, color: "err", icon: <IssueIcon d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /> },
    { key: "inconsistent_albums", label: "Album Inconsistencies", count: result.summary.inconsistent_albums, color: "cyan", icon: <IssueIcon d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-9L21 7.5m0 0L16.5 12M21 7.5H7.5" /> },
  ] : [];

  const totalIssues = issueCategories.reduce((s, c) => s + c.count, 0);
  const healthScore = !result ? 100 : result.total_tracks === 0 ? 100 : Math.max(0, Math.round(100 - (totalIssues / result.total_tracks) * 100));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-t-secondary">
          Scan your library for missing tags, artwork, broken files, and inconsistencies.
        </p>
        <button onClick={runCheck} disabled={scanning} className="btn btn-primary">
          {scanning ? "Scanning..." : "Run Health Check"}
        </button>
      </div>

      {scanning && (progress.total > 0 ? (
        <ProgressBar
          percent={progress.percent}
          label={progress.message || "Checking..."}
          sublabel={`${progress.current} / ${progress.total}`}
        />
      ) : (
        <ProgressBar indeterminate label="Scanning library..." />
      ))}

      {result && (
        <>
          {/* Score card */}
          <div className="card p-6 flex items-center gap-5">
            <div className="flex items-baseline gap-1">
              <span className="text-[52px] font-display font-extrabold leading-none tracking-[-0.03em]" style={{ color: healthScore >= 90 ? "var(--emer)" : healthScore >= 60 ? "var(--amber)" : "var(--err)" }}>{healthScore}</span>
              <span className="text-[18px] font-bold text-ink3">/100</span>
            </div>
            <div className="w-px self-stretch" style={{ background: "var(--line)" }} />
            <div>
              <p className="text-[15px] font-bold text-ink">{totalIssues === 0 ? "Library looks great" : `${totalIssues} issue${totalIssues !== 1 ? "s" : ""} to review`}</p>
              <p className="font-mono text-[10px] text-ink3 mt-1">{result.total_tracks.toLocaleString()} TRACKS SCANNED</p>
            </div>
          </div>

          {/* Issue categories */}
          <div className="grid grid-cols-3 gap-3">
            {issueCategories.map((cat) => {
              const open = expandedSection === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => cat.count > 0 && setExpandedSection(open ? null : cat.key)}
                  disabled={cat.count === 0}
                  className={`card p-4 text-left transition-all ${cat.count > 0 ? "cursor-pointer hover:-translate-y-0.5" : "opacity-45"}`}
                  style={open ? { borderColor: `var(--${cat.color})` } : undefined}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold" style={{ background: `var(--${cat.color}S)`, color: `var(--${cat.color})` }}>{cat.icon}</span>
                    <span className="text-[22px] font-display font-extrabold tabular-nums" style={{ color: cat.count > 0 ? `var(--${cat.color})` : "var(--ink3)" }}>{cat.count}</span>
                  </div>
                  <p className="text-[12px] font-medium text-ink2">{cat.label}</p>
                </button>
              );
            })}
          </div>

          {/* Expanded issue list */}
          {expandedSection && (
            <IssueList
              category={expandedSection}
              result={result}
              onClose={() => setExpandedSection(null)}
            />
          )}
        </>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err">
          {error}
        </div>
      )}
    </div>
  );
}

function IssueList({ category, result, onClose }: { category: string; result: HealthCheckResult; onClose: () => void }) {
  const categoryLabels: Record<string, string> = {
    missing_title: "Tracks Missing Title",
    missing_artist: "Tracks Missing Artist",
    missing_album: "Tracks Missing Album",
    no_artwork: "Tracks Without Artwork",
    broken_files: "Broken / Unreadable Files",
    inconsistent_albums: "Albums with Inconsistent Artists",
  };

  const items = category === "inconsistent_albums"
    ? result.issues.inconsistent_albums
    : (result.issues as Record<string, unknown[]>)[category] as Record<string, string>[];

  return (
    <div className="card overflow-hidden" style={{ animation: "slideUp 150ms ease-out" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-line panel2">
        <span className="text-[13px] font-semibold text-ink">{categoryLabels[category] || category}</span>
        <button onClick={onClose} className="text-ink3 hover:text-ink transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {category === "inconsistent_albums" ? (
          (items as unknown as { album: string; artists: string[]; track_count: number }[]).map((item, i) => (
            <div key={i} className="px-4 py-2.5 border-b border-line2 last:border-0">
              <p className="text-[13px] font-medium text-t">{item.album}</p>
              <p className="text-[11px] text-t-muted mt-0.5">
                {item.track_count} tracks · Artists: {item.artists.join(", ")}
              </p>
            </div>
          ))
        ) : (
          (items as Record<string, string>[]).map((item, i) => (
            <div key={i} className="px-4 py-2.5 border-b border-line2 last:border-0">
              <p className="text-[13px] text-t truncate">{item.title || item.filename || item.path}</p>
              <p className="text-[11px] text-t-muted truncate">
                {item.artist ? `${item.artist} · ` : ""}{item.path}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ================================================================ */
/*  Duplicates Finder                                                 */
/* ================================================================ */

const NOT_DUP_KEY = "grapefruit:notDuplicates";
const dupKey = (g: DuplicateGroup) => `${(g.artist || "").toLowerCase()}|||${(g.title || "").toLowerCase()}`;
function loadNotDuplicates(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(NOT_DUP_KEY) || "[]")); } catch { return new Set(); }
}
function saveNotDuplicates(s: Set<string>) {
  try { localStorage.setItem(NOT_DUP_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

function DuplicatesTab() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<Set<string>>(() => loadNotDuplicates());

  const visibleGroups = useMemo(() => groups.filter((g) => !ignored.has(dupKey(g))), [groups, ignored]);
  const hiddenCount = groups.length - visibleGroups.length;

  const markNotDuplicate = useCallback((g: DuplicateGroup) => {
    setIgnored((prev) => {
      const next = new Set(prev);
      next.add(dupKey(g));
      saveNotDuplicates(next);
      return next;
    });
  }, []);

  const resetIgnored = useCallback(() => {
    setIgnored(new Set());
    saveNotDuplicates(new Set());
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setGroups([]);
    setMsg(null);
    try {
      const res = await rpcCall<DuplicateGroup[]>("find_duplicates", {});
      setGroups(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }, []);

  const deleteCopy = useCallback(async (path: string) => {
    setBusy(true);
    try {
      await rpcCall("delete_files", { paths: [path] });
      setGroups((prev) =>
        prev
          .map((g) => ({ ...g, copies: g.copies.filter((c) => c.relative_path !== path) }))
          .filter((g) => g.copies.length > 1)
      );
      setMsg("Moved to trash");
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-t-secondary">
          Find duplicate tracks by matching artist and title.
        </p>
        <button onClick={scan} disabled={scanning} className="btn btn-primary">
          {scanning ? "Scanning..." : "Find Duplicates"}
        </button>
      </div>

      {scanning && <ProgressBar indeterminate label="Scanning for duplicates..." />}

      {msg && (
        <div className="p-3 rounded-xl bg-ok-muted border border-ok/20 text-[13px] text-ok">{msg}</div>
      )}

      {(visibleGroups.length > 0 || hiddenCount > 0) && (
        <div className="space-y-2">
          <p className="text-sm font-medium" style={{ color: "var(--amber)" }}>
            {visibleGroups.length} duplicate group{visibleGroups.length !== 1 ? "s" : ""} found
            {hiddenCount > 0 && <span className="text-ink3 font-normal"> · {hiddenCount} ignored</span>}
          </p>
          {visibleGroups.map((g, gi) => (
            <div key={gi} className="card overflow-hidden">
              <div className="px-4 py-2.5 panel2 border-b border-line flex items-center gap-2.5">
                <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--pinkS)", color: "var(--pink)" }}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75" />
                  </svg>
                </span>
                <span className="text-[13px] font-medium text-ink truncate">{g.artist} — {g.title}</span>
                <span className="badge badge-amber ml-auto shrink-0">{g.copies.length} copies</span>
                <button onClick={() => markNotDuplicate(g)} title="Different versions, not duplicates" className="btn btn-ghost text-[10px] py-0.5 px-2 shrink-0">Not a duplicate</button>
              </div>
              {g.copies.map((copy, ci) => {
                const keep = ci === 0;
                return (
                  <div key={ci} className="flex items-center gap-3 px-4 py-2.5 border-b border-line2 last:border-0 hover:bg-panel2 transition-colors">
                    <span className="font-mono text-[8px] font-bold tracking-[.08em] px-1.5 py-1 rounded-md shrink-0" style={keep ? { background: "var(--emerS)", color: "var(--emer)" } : { background: "var(--errS)", color: "var(--err)" }}>{keep ? "KEEP" : "DROP"}</span>
                    <span className="text-[12px] text-ink2 flex-1 truncate">{copy.relative_path}</span>
                    <span className="font-mono text-[10px] text-ink3 tabular-nums shrink-0">{(copy.file_size / (1024 * 1024)).toFixed(1)} MB</span>
                    <span className="font-mono text-[9px] text-ink3 uppercase shrink-0">{copy.format}</span>
                    {!keep && (
                      <button onClick={() => deleteCopy(copy.relative_path)} disabled={busy} className="btn btn-danger text-[10px] py-0.5 px-2.5 shrink-0">Remove</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {ignored.size > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <span className="font-mono text-[10px] text-ink3">{ignored.size} marked not duplicates</span>
              <button onClick={resetIgnored} className="font-mono text-[10px] text-brand hover:opacity-80 transition-opacity">Reset</button>
            </div>
          )}
        </div>
      )}

      {!scanning && groups.length === 0 && error === null && (
        <div className="card p-8 text-center">
          <p className="text-sm text-t-muted">Click "Find Duplicates" to scan your library.</p>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err">
          {error}
        </div>
      )}
    </div>
  );
}

/* ================================================================ */
/*  Auto-Organize                                                     */
/* ================================================================ */

function OrganizeTab() {
  const { refreshLibrary } = useDeviceStore();
  const [pattern, setPattern] = useState("{artist}/{album}");
  const [dryResult, setDryResult] = useState<OrganizeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const organizeProgress = useProgress("auto_organize");

  const preview = useCallback(async () => {
    setRunning(true);
    setError(null);
    setDryResult(null);
    setDone(false);
    try {
      const res = await rpcCall<OrganizeResult>("auto_organize", { pattern, dry_run: true });
      setDryResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }, [pattern]);

  const execute = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await rpcCall<OrganizeResult>("auto_organize", { pattern, dry_run: false });
      setDone(true);
      setDryResult(res);
      await refreshLibrary();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }, [pattern, refreshLibrary]);

  const patterns = [
    { value: "{artist}/{album}", label: "Artist / Album" },
    { value: "{artist}/{album}/{track:02d} - {title}", label: "Artist / Album / 01 - Title" },
    { value: "{genre}/{artist}/{album}", label: "Genre / Artist / Album" },
    { value: "{artist} - {album}", label: "Artist - Album (flat)" },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-t-secondary">
        Reorganize your music files into a clean folder structure based on tags.
      </p>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-t mb-3">Organization Pattern</h3>
        <div className="grid grid-cols-2 gap-2">
          {patterns.map((p) => {
            const sel = pattern === p.value;
            return (
              <button
                key={p.value}
                onClick={() => setPattern(p.value)}
                className="p-3 rounded-xl border text-left transition-all hover:bg-panel2"
                style={sel ? { borderColor: "var(--amber)", background: "var(--amberS)" } : { borderColor: "var(--line)" }}
              >
                <p className="text-[12px] font-medium" style={{ color: sel ? "var(--amber)" : "var(--ink)" }}>{p.label}</p>
                <p className="text-[10px] text-ink3 mt-0.5 font-mono">{p.value}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={preview} disabled={running} className="btn btn-secondary">
          {running && !dryResult ? "Analyzing..." : "Preview Changes"}
        </button>
        {dryResult && !done && dryResult.moved > 0 && (
          <button onClick={execute} disabled={running} className="btn btn-primary">
            {running ? "Organizing..." : `Organize ${dryResult.moved} Files`}
          </button>
        )}
      </div>

      {running && (organizeProgress.total > 0 ? (
        <ProgressBar
          percent={organizeProgress.percent}
          label="Organizing files..."
          sublabel={`${organizeProgress.current} / ${organizeProgress.total}`}
        />
      ) : (
        <ProgressBar indeterminate label={dryResult ? "Organizing files..." : "Analyzing library..."} />
      ))}

      {done && dryResult && (
        <div className="card p-5" style={{ borderColor: "var(--emer)", background: "var(--emerS)" }}>
          <p className="text-[13px] font-semibold" style={{ color: "var(--emer)" }}>
            Organized {dryResult.moved} file{dryResult.moved !== 1 ? "s" : ""}!
          </p>
          {dryResult.errors.length > 0 && (
            <p className="text-[12px] mt-1" style={{ color: "var(--amber)" }}>{dryResult.errors.length} errors</p>
          )}
        </div>
      )}

      {dryResult && !done && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 panel2 border-b border-line">
            <span className="text-[13px] font-semibold text-ink">
              {dryResult.moved > 0 ? `${dryResult.moved} files to move` : "No changes needed"}
            </span>
          </div>
          {dryResult.plan && dryResult.plan.length > 0 && (
            <div className="max-h-60 overflow-y-auto">
              {dryResult.plan.slice(0, 50).map((item, i) => (
                <div key={i} className="px-4 py-2 border-b border-line2 last:border-0 text-[11px] font-mono">
                  <p className="truncate" style={{ color: "var(--ink3)" }}>{item.from}</p>
                  <p className="truncate mt-0.5" style={{ color: "var(--emer)" }}>→ {item.to}</p>
                </div>
              ))}
              {dryResult.plan.length > 50 && (
                <p className="text-ink3 text-[11px] text-center py-2">
                  ...and {dryResult.plan.length - 50} more
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err">{error}</div>
      )}
    </div>
  );
}

/* ================================================================ */
/*  Main Page                                                          */
/* ================================================================ */

const TABS: { key: ToolTab; label: string; color: string; borderColor: string; icon: React.ReactNode }[] = [
  {
    key: "health", label: "Health Check", color: "text-cyan", borderColor: "border-cyan",
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>,
  },
  {
    key: "duplicates", label: "Duplicates", color: "text-pink", borderColor: "border-pink",
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>,
  },
  {
    key: "organize", label: "Organize", color: "text-amber", borderColor: "border-amber",
    icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" /></svg>,
  },
];

export default function Tools() {
  const { selectedDevice } = useDeviceStore();
  const [tab, setTab] = useState<ToolTab>("health");

  if (!selectedDevice) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] text-center gap-7">
        <div className="relative">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(244, 114, 182, 0.06) 100%)", boxShadow: "0 0 48px rgba(245, 158, 11, 0.1), 0 8px 24px rgba(0,0,0,0.25)" }}>
            <svg className="w-10 h-10 text-amber/50" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63" />
            </svg>
          </div>
          <div className="absolute -inset-4 rounded-[28px] opacity-40" style={{ background: "radial-gradient(circle, rgba(245, 158, 11, 0.08) 0%, transparent 70%)" }} />
        </div>
        <div className="space-y-2 max-w-xs">
          <h2 className="text-lg font-semibold text-t">Library Tools</h2>
          <p className="text-sm text-t-muted leading-relaxed">Connect a device or local folder to use health check, duplicate finder, and organization tools.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1150px] flex flex-col gap-5">
      {/* Pill tabs */}
      <div className="flex gap-1.5 p-[3px] rounded-full panel2 w-fit">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] transition-all"
              style={active ? { background: "var(--panel)", fontWeight: 700, color: "var(--ink)", boxShadow: "var(--shadow)" } : { fontWeight: 500, color: "var(--ink2)" }}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "health" && <HealthCheckTab />}
      {tab === "duplicates" && <DuplicatesTab />}
      {tab === "organize" && <OrganizeTab />}
    </div>
  );
}
