import React, { useState, useCallback } from "react";
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
    { key: "missing_title", label: "Missing Title", count: result.summary.missing_title, color: "err", icon: "T" },
    { key: "missing_artist", label: "Missing Artist", count: result.summary.missing_artist, color: "pink", icon: "A" },
    { key: "missing_album", label: "Missing Album", count: result.summary.missing_album, color: "violet", icon: "Al" },
    { key: "no_artwork", label: "No Artwork", count: result.summary.no_artwork, color: "amber", icon: "🖼" },
    { key: "broken_files", label: "Broken Files", count: result.summary.broken_files, color: "err", icon: "!" },
    { key: "inconsistent_albums", label: "Album Inconsistencies", count: result.summary.inconsistent_albums, color: "cyan", icon: "≠" },
  ] : [];

  const totalIssues = issueCategories.reduce((s, c) => s + c.count, 0);

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

      {scanning && progress.total > 0 && (
        <ProgressBar
          percent={progress.percent}
          label={progress.message || "Checking..."}
          sublabel={`${progress.current} / ${progress.total}`}
        />
      )}

      {result && (
        <>
          {/* Score card */}
          <div className="card p-5 flex items-center gap-4">
            <div className={`icon-box icon-box-lg ${totalIssues === 0 ? "icon-box-emerald" : totalIssues < 20 ? "icon-box-amber" : "icon-box-err"}`}>
              <span className="text-lg font-bold">{totalIssues === 0 ? "✓" : totalIssues}</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-t">
                {totalIssues === 0 ? "Library looks great!" : `${totalIssues} issue${totalIssues !== 1 ? "s" : ""} found`}
              </p>
              <p className="text-xs text-t-muted">{result.total_tracks} tracks scanned</p>
            </div>
          </div>

          {/* Issue categories */}
          <div className="grid grid-cols-3 gap-3">
            {issueCategories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => cat.count > 0 && setExpandedSection(expandedSection === cat.key ? null : cat.key)}
                disabled={cat.count === 0}
                className={`card p-4 text-left transition-all ${
                  cat.count > 0 ? "hover:border-b-light cursor-pointer" : "opacity-50"
                } ${expandedSection === cat.key ? `border-${cat.color}` : ""}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={`icon-box icon-box-sm icon-box-${cat.color}`}>
                    <span className="text-[10px] font-bold">{cat.icon}</span>
                  </div>
                  <span className={`text-xl font-bold tabular-nums text-${cat.color}`}>{cat.count}</span>
                </div>
                <p className="text-[12px] font-medium text-t-secondary">{cat.label}</p>
              </button>
            ))}
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
      <div className="flex items-center justify-between px-4 py-3 border-b bg-bg-surface">
        <span className="text-[13px] font-semibold text-t">{categoryLabels[category] || category}</span>
        <button onClick={onClose} className="text-t-muted hover:text-t transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {category === "inconsistent_albums" ? (
          (items as unknown as { album: string; artists: string[]; track_count: number }[]).map((item, i) => (
            <div key={i} className="px-4 py-2.5 border-b border-b-[rgba(255,255,255,0.04)] last:border-0">
              <p className="text-[13px] font-medium text-t">{item.album}</p>
              <p className="text-[11px] text-t-muted mt-0.5">
                {item.track_count} tracks · Artists: {item.artists.join(", ")}
              </p>
            </div>
          ))
        ) : (
          (items as Record<string, string>[]).map((item, i) => (
            <div key={i} className="px-4 py-2.5 border-b border-b-[rgba(255,255,255,0.04)] last:border-0">
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

function DuplicatesTab() {
  const { refreshLibrary } = useDeviceStore();
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

      {msg && (
        <div className="p-3 rounded-xl bg-ok-muted border border-ok/20 text-[13px] text-ok">{msg}</div>
      )}

      {groups.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-amber font-medium">{groups.length} duplicate group{groups.length !== 1 ? "s" : ""} found</p>
          {groups.map((g, gi) => (
            <div key={gi} className="card overflow-hidden">
              <div className="px-4 py-2.5 bg-bg-surface border-b flex items-center gap-2">
                <div className="icon-box icon-box-sm icon-box-pink">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75" />
                  </svg>
                </div>
                <span className="text-[13px] font-medium text-t">{g.artist} — {g.title}</span>
                <span className="badge badge-amber ml-auto">{g.copies.length} copies</span>
              </div>
              {g.copies.map((copy, ci) => (
                <div key={ci} className="flex items-center gap-3 px-4 py-2 border-b border-b-[rgba(255,255,255,0.04)] last:border-0 hover:bg-bg-hover transition-colors">
                  <span className="text-[12px] text-t-secondary flex-1 truncate">{copy.relative_path}</span>
                  <span className="text-[11px] text-t-muted tabular-nums shrink-0">
                    {(copy.file_size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                  <span className="text-[11px] text-t-muted uppercase shrink-0">{copy.format}</span>
                  {ci > 0 && (
                    <button
                      onClick={() => deleteCopy(copy.relative_path)}
                      disabled={busy}
                      className="btn btn-danger text-[10px] py-0.5 px-2 shrink-0"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
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
          {patterns.map((p) => (
            <button
              key={p.value}
              onClick={() => setPattern(p.value)}
              className={`p-3 rounded-lg border text-left transition-all ${
                pattern === p.value
                  ? "border-amber bg-amber-muted"
                  : "border-b hover:border-b-light hover:bg-bg-hover"
              }`}
            >
              <p className={`text-[12px] font-medium ${pattern === p.value ? "text-amber" : "text-t"}`}>{p.label}</p>
              <p className="text-[10px] text-t-muted mt-0.5 font-mono">{p.value}</p>
            </button>
          ))}
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

      {done && dryResult && (
        <div className="card p-5 border-emerald/20 bg-emerald-muted">
          <p className="text-[13px] font-semibold text-emerald">
            Organized {dryResult.moved} file{dryResult.moved !== 1 ? "s" : ""}!
          </p>
          {dryResult.errors.length > 0 && (
            <p className="text-[12px] text-amber mt-1">{dryResult.errors.length} errors</p>
          )}
        </div>
      )}

      {dryResult && !done && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b bg-bg-surface">
            <span className="text-[13px] font-semibold text-t">
              {dryResult.moved > 0 ? `${dryResult.moved} files to move` : "No changes needed"}
            </span>
          </div>
          {dryResult.plan && dryResult.plan.length > 0 && (
            <div className="max-h-60 overflow-y-auto">
              {dryResult.plan.slice(0, 50).map((item, i) => (
                <div key={i} className="px-4 py-2 border-b border-b-[rgba(255,255,255,0.04)] last:border-0 text-[11px]">
                  <p className="text-err/70 truncate">{item.from}</p>
                  <p className="text-emerald truncate mt-0.5">→ {item.to}</p>
                </div>
              ))}
              {dryResult.plan.length > 50 && (
                <p className="text-t-muted text-[11px] text-center py-2">
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
    <div className="max-w-3xl">
      <div className="mb-6 pt-2">
        <h1 className="text-3xl font-bold text-t tracking-tight">Tools</h1>
        <p className="text-sm text-t-muted mt-1">Manage metadata, find issues, and organize your library</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-5 border-b mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              tab === t.key
                ? `${t.borderColor} ${t.color}`
                : "border-transparent text-t-muted hover:text-t-secondary"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "health" && <HealthCheckTab />}
      {tab === "duplicates" && <DuplicatesTab />}
      {tab === "organize" && <OrganizeTab />}
    </div>
  );
}
