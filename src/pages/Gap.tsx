import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useGapStore, type GapFilter } from "../stores/gapStore";
import { useDeviceStore } from "../stores/deviceStore";
import { useToastStore } from "../stores/toastStore";
import { spotifyGetStatus } from "../api/spotify";
import { rpcCall } from "../api/sidecar";
import { ProgressBar } from "../components/ProgressBar";
import { useProgress } from "../hooks/useProgress";
import type { MatchResult, SpotifyStatus } from "../types/models";

/* ── helpers ─────────────────────────────────── */

const isMissing = (r: MatchResult) => r.status === "missing" || r.status === "rejected";
const isUncertain = (r: MatchResult) => r.status === "uncertain";

function buildTxt(rows: MatchResult[]): string {
  return rows.map((r) => `${r.playlist_track.artist} - ${r.playlist_track.title}`).join("\n") + "\n";
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function buildCsv(rows: MatchResult[]): string {
  const header = "Artist,Title,Album,Status,Library Match\n";
  const body = rows
    .map((r) => {
      const lt = r.best_match?.local_track;
      const match = lt ? `${lt.artist} - ${lt.title}` : "";
      return [
        csvEscape(r.playlist_track.artist),
        csvEscape(r.playlist_track.title),
        csvEscape(r.playlist_track.album ?? ""),
        r.status,
        csvEscape(match),
      ].join(",");
    })
    .join("\n");
  return header + body + "\n";
}

/* ── page ────────────────────────────────────── */

export default function Gap() {
  const gap = useGapStore();
  const { selectedDevice, tracks, loadingLibrary, connectLocalLibrary } = useDeviceStore();
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const [includePlaylists, setIncludePlaylists] = useState(true);

  useEffect(() => {
    spotifyGetStatus().then(setSpotify).catch(() => setSpotify(null));
  }, []);

  const libraryReady = !!selectedDevice && tracks.length > 0;

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <div className="mb-6 pt-2">
        <h1 className="text-3xl font-bold text-t tracking-tight">Streaming Gap</h1>
        <p className="text-sm text-t-muted mt-1">
          Find the songs in your streaming world that are missing from the library you own
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pb-6">
        {!selectedDevice ? (
          <ConnectLibraryPrompt onConnect={connectLocalLibrary} />
        ) : loadingLibrary ? (
          <ScanningCard />
        ) : gap.step === "idle" ? (
          <SourcePicker
            spotify={spotify}
            includePlaylists={includePlaylists}
            setIncludePlaylists={setIncludePlaylists}
            libraryReady={libraryReady}
          />
        ) : gap.step === "fetching" || gap.step === "matching" ? (
          <WorkingCard step={gap.step} source={gap.source} />
        ) : (
          <Results />
        )}

        {gap.error && (
          <div className="mt-4 p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err flex items-center justify-between">
            <span>{gap.error}</span>
            <button onClick={() => gap.reset()} className="btn btn-ghost text-xs text-err ml-4">
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── empty state: no library ─────────────────── */

function ConnectLibraryPrompt({ onConnect }: { onConnect: (path: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const browse = async () => {
    setErr(null);
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Select your music library folder",
      });
      if (!selected) return;
      setBusy(true);
      await onConnect(typeof selected === "string" ? selected : String(selected));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-16 text-center">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
        style={{
          background:
            "linear-gradient(135deg, rgba(255, 127, 102, 0.18) 0%, rgba(229, 80, 58, 0.08) 100%)",
          boxShadow: "0 0 40px rgba(255, 99, 71, 0.12)",
        }}
      >
        <svg className="w-8 h-8 text-gf/70" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
      </div>
      <h2 className="text-lg font-bold text-t">Connect your music library</h2>
      <p className="text-sm text-t-muted mt-2 mb-6 leading-relaxed">
        The gap report compares streaming playlists against the music you already own.
        Point Grapefruit at your music folder (or connect a device) to get started.
      </p>
      <button onClick={browse} disabled={busy} className="btn btn-primary">
        {busy ? "Connecting..." : "Choose Music Folder"}
      </button>
      {err && <p className="text-[12px] text-err mt-3">{err}</p>}
    </div>
  );
}

function ScanningCard() {
  const progress = useProgress("scan_device_library");
  return (
    <div className="max-w-md mx-auto mt-16 text-center">
      <div className="card p-6 space-y-4">
        <p className="text-sm font-semibold text-t">Scanning your library...</p>
        <ProgressBar
          percent={progress.percent}
          sublabel={progress.total > 0 ? `${progress.current.toLocaleString()} / ${progress.total.toLocaleString()}` : undefined}
        />
      </div>
    </div>
  );
}

/* ── source picker ───────────────────────────── */

function SourcePicker({
  spotify,
  includePlaylists,
  setIncludePlaylists,
  libraryReady,
}: {
  spotify: SpotifyStatus | null;
  includePlaylists: boolean;
  setIncludePlaylists: (v: boolean) => void;
  libraryReady: boolean;
}) {
  const { source, setSource, url, setUrl, runUrlGap, runSpotifyGap } = useGapStore();
  const { tracks } = useDeviceStore();
  const urlValid = url.includes("spotify.com/") || url.includes("music.apple.com/");
  const connected = spotify?.connected ?? false;
  const [showAppleHelp, setShowAppleHelp] = useState(false);

  return (
    <div className="max-w-2xl mx-auto mt-6">
      {libraryReady && (
        <p className="text-[12px] text-t-muted text-center mb-6">
          Comparing against <span className="text-t-secondary font-semibold">{tracks.length.toLocaleString()}</span> tracks in your library
        </p>
      )}

      {/* Source cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <button
          onClick={() => setSource("url")}
          className={`card p-4 text-left transition-all ${
            source === "url" ? "border-gf/60 ring-1 ring-gf/30" : "hover:border-b-light"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="icon-box icon-box-md icon-box-pink">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
              </svg>
            </div>
            <p className="text-sm font-bold text-t">Playlist URL</p>
          </div>
          <p className="text-[12px] text-t-muted leading-relaxed">
            Paste any public Spotify or Apple Music playlist link. No login needed.
          </p>
        </button>

        <button
          onClick={() => setSource("spotify")}
          className={`card p-4 text-left transition-all ${
            source === "spotify" ? "border-gf/60 ring-1 ring-gf/30" : "hover:border-b-light"
          }`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="icon-box icon-box-md icon-box-emerald">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.622.622 0 01-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.622.622 0 11-.277-1.215c3.809-.871 7.077-.496 9.713 1.115a.623.623 0 01.206.857zm1.223-2.722a.78.78 0 01-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166A.78.78 0 016.32 11.3c3.632-1.102 8.147-.568 11.234 1.328a.78.78 0 01.255 1.074zm.105-2.835c-3.223-1.914-8.54-2.09-11.618-1.156a.935.935 0 11-.543-1.79c3.532-1.072 9.404-.865 13.115 1.338a.936.936 0 01-.954 1.608z" />
              </svg>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-t">My Spotify Library</p>
              {connected && <span className="badge badge-emerald text-[9px]">Connected</span>}
            </div>
          </div>
          <p className="text-[12px] text-t-muted leading-relaxed">
            Your entire account — Liked Songs plus every playlist you follow.
          </p>
        </button>
      </div>

      {/* URL mode */}
      {source === "url" && (
        <div className="card p-5">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && urlValid && runUrlGap(url)}
            placeholder="https://open.spotify.com/playlist/..."
            className="input text-center py-3"
            autoFocus
          />
          <button
            onClick={() => runUrlGap(url)}
            disabled={!urlValid || !libraryReady}
            className="btn btn-primary w-full mt-3 py-2.5"
          >
            Find Missing Songs
          </button>
          {!libraryReady && (
            <p className="text-[11px] text-amber mt-2 text-center">
              Your library is still scanning — hang tight.
            </p>
          )}

          {/* Apple Music whole-library helper (no API/account needed) */}
          <div className="mt-4 pt-3 border-t border-b-[rgba(255,255,255,0.06)]">
            <button
              onClick={() => setShowAppleHelp((v) => !v)}
              className="flex items-center gap-1.5 text-[11px] text-t-muted hover:text-t-secondary transition-colors"
            >
              <svg className={`w-3 h-3 transition-transform ${showAppleHelp ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              Compare your whole Apple Music library
            </button>
            {showAppleHelp && (
              <ol className="text-[12px] text-t-secondary space-y-1.5 list-decimal list-inside leading-relaxed mt-3 pl-1">
                <li>In Apple Music, make a new playlist (e.g. &ldquo;My Library&rdquo;).</li>
                <li>Open your <strong>Songs</strong>, select all (⌘A / Ctrl+A), and add them to it.</li>
                <li>Right-click the playlist → <strong>Share</strong> → <strong>Copy Link</strong> (make it public if asked).</li>
                <li>Paste that link above and run the report.</li>
              </ol>
            )}
          </div>
        </div>
      )}

      {/* Spotify mode */}
      {source === "spotify" &&
        (connected ? (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[13px] font-semibold text-t">
                  {spotify?.user_name ? `Connected as ${spotify.user_name}` : "Connected"}
                </p>
                <p className="text-[11px] text-t-muted mt-0.5">
                  Liked Songs{includePlaylists ? " + all playlists" : " only"}, deduplicated
                </p>
              </div>
              <button
                onClick={() => setIncludePlaylists(!includePlaylists)}
                className={`relative w-10 h-5 rounded-full transition-colors ${includePlaylists ? "bg-emerald" : "bg-bg-surface"}`}
                title="Include playlists"
              >
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${includePlaylists ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
            <button
              onClick={() => runSpotifyGap(includePlaylists)}
              disabled={!libraryReady}
              className="btn btn-primary w-full py-2.5"
            >
              Analyze My Library
            </button>
          </div>
        ) : (
          <div className="card p-5 text-center">
            <p className="text-[13px] text-t-secondary leading-relaxed mb-4">
              Connect your Spotify account to analyze your whole library —<br />
              a one-time setup in Settings.
            </p>
            <Link to="/settings" className="btn btn-secondary text-xs">
              Connect Spotify in Settings →
            </Link>
          </div>
        ))}
    </div>
  );
}

/* ── progress ────────────────────────────────── */

function WorkingCard({ step, source }: { step: "fetching" | "matching"; source: string }) {
  const fetchProgress = useProgress("fetch_playlist");
  const spotifyProgress = useProgress("spotify_fetch");
  const matchProgress = useProgress("match_tracks");

  const p = step === "matching" ? matchProgress : source === "spotify" ? spotifyProgress : fetchProgress;
  const label =
    step === "matching"
      ? "Matching against your library..."
      : source === "spotify"
        ? "Fetching your Spotify library..."
        : "Fetching playlist...";

  return (
    <div className="max-w-md mx-auto mt-16 text-center">
      <div className="card p-6 space-y-4">
        <p className="text-sm font-semibold text-t">{label}</p>
        <ProgressBar
          percent={p.percent}
          sublabel={
            p.message ||
            (p.total > 0 ? `${p.current.toLocaleString()} / ${p.total.toLocaleString()}` : undefined)
          }
        />
        {source === "spotify" && step === "fetching" && (
          <p className="text-[11px] text-t-muted">Large libraries can take a minute or two</p>
        )}
      </div>
    </div>
  );
}

/* ── results ─────────────────────────────────── */

function Results() {
  const { metadata, matchResults, filter, setFilter, reset } = useGapStore();
  const addToast = useToastStore((s) => s.addToast);

  const missing = useMemo(() => matchResults.filter(isMissing), [matchResults]);
  const uncertain = useMemo(() => matchResults.filter(isUncertain), [matchResults]);
  const have = matchResults.length - missing.length - uncertain.length;

  const visible = filter === "missing" ? missing : filter === "uncertain" ? uncertain : matchResults;

  const copyList = async () => {
    if (visible.length === 0) return;
    await navigator.clipboard.writeText(buildTxt(visible));
    addToast("success", `Copied ${visible.length} tracks to clipboard`);
  };

  const exportFile = async () => {
    if (visible.length === 0) return;
    const base = (metadata?.name ?? "gap-report").replace(/[<>:"/\\|?*]/g, "");
    const path = await saveDialog({
      title: "Export Track List",
      defaultPath: `${base} - ${filter}.csv`,
      filters: [
        { name: "CSV", extensions: ["csv"] },
        { name: "Text", extensions: ["txt"] },
      ],
    });
    if (!path) return;
    const content = path.toLowerCase().endsWith(".txt") ? buildTxt(visible) : buildCsv(visible);
    await rpcCall("write_text_file", { path, content });
    addToast("success", `Exported ${visible.length} tracks`);
  };

  const filters: { key: GapFilter; label: string; count: number; badge: string }[] = [
    { key: "missing", label: "Missing", count: missing.length, badge: "badge-err" },
    { key: "uncertain", label: "Uncertain", count: uncertain.length, badge: "badge-amber" },
    { key: "all", label: "All", count: matchResults.length, badge: "badge-cyan" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-t">{metadata?.name ?? "Gap Report"}</h2>
          <p className="text-sm mt-1">
            {missing.length > 0 ? (
              <span className="text-err font-bold">
                {missing.length} song{missing.length === 1 ? "" : "s"} to find
              </span>
            ) : (
              <span className="text-emerald font-bold">Nothing missing — you have it all 🎉</span>
            )}
            <span className="text-t-muted">
              {" "}· {have} in library{uncertain.length > 0 ? ` · ${uncertain.length} uncertain` : ""}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={copyList} disabled={visible.length === 0} className="btn btn-secondary text-xs">
            Copy List
          </button>
          <button onClick={exportFile} disabled={visible.length === 0} className="btn btn-secondary text-xs">
            Export...
          </button>
          <button onClick={reset} className="btn btn-ghost text-xs">
            New Report
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              filter === f.key ? "bg-bg-hover text-t ring-1 ring-white/10" : "text-t-secondary hover:bg-bg-hover"
            }`}
          >
            {f.label}
            <span className={`badge ${f.badge} text-[9px]`}>{f.count}</span>
          </button>
        ))}
      </div>

      {/* Track rows */}
      <div className="card overflow-hidden">
        <div className="max-h-[calc(100vh-330px)] overflow-y-auto">
          {visible.length === 0 ? (
            <p className="text-center text-[13px] text-t-muted py-10">
              {filter === "missing" ? "No missing tracks in this report." : "Nothing in this bucket."}
            </p>
          ) : (
            visible.map((r, i) => <GapRow key={i} result={r} />)
          )}
        </div>
      </div>
    </div>
  );
}

function GapRow({ result }: { result: MatchResult }) {
  const pt = result.playlist_track;
  const lt = result.best_match?.local_track;
  const missing = isMissing(result);
  const uncertain = isUncertain(result);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-b-[rgba(255,255,255,0.04)] last:border-b-0 hover:bg-bg-hover/40 transition-colors">
      <div
        className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
          missing ? "bg-err-muted text-err" : uncertain ? "bg-amber-muted text-amber" : "bg-ok-muted text-ok"
        }`}
      >
        {missing ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : uncertain ? (
          <span className="text-[11px] font-bold">?</span>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-t truncate">
          <span className="font-semibold">{pt.artist}</span>
          <span className="text-t-muted"> — </span>
          {pt.title}
        </p>
        {uncertain && lt && (
          <p className="text-[11px] text-amber/80 truncate">
            Maybe: {lt.artist} — {lt.title} ({Math.round(result.best_match!.score)}%)
          </p>
        )}
      </div>

      {pt.album && <p className="text-[11px] text-t-muted truncate max-w-[200px] shrink-0">{pt.album}</p>}
    </div>
  );
}
