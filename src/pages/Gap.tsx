import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useGapStore, type GapFilter } from "../stores/gapStore";
import { useDeviceStore } from "../stores/deviceStore";
import { useToastStore } from "../stores/toastStore";
import { spotifyGetStatus } from "../api/spotify";
import { rpcCall } from "../api/sidecar";
import { useProgress } from "../hooks/useProgress";
import { SoulseekSearchModal } from "../components/SoulseekSearchModal";
import type { MatchResult, SpotifyStatus } from "../types/models";

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
  const body = rows.map((r) => {
    const lt = r.best_match?.local_track;
    return [csvEscape(r.playlist_track.artist), csvEscape(r.playlist_track.title), csvEscape(r.playlist_track.album ?? ""), r.status, csvEscape(lt ? `${lt.artist} - ${lt.title}` : "")].join(",");
  }).join("\n");
  return header + body + "\n";
}

export default function Gap() {
  const gap = useGapStore();
  const { selectedDevice, tracks, loadingLibrary, connectLocalLibrary } = useDeviceStore();
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const [includePlaylists, setIncludePlaylists] = useState(true);

  useEffect(() => { spotifyGetStatus().then(setSpotify).catch(() => setSpotify(null)); }, []);

  const libraryReady = !!selectedDevice && tracks.length > 0;

  return (
    <div className="flex flex-col gap-[18px] max-w-[1600px]">
      {!selectedDevice ? (
        <ConnectLibraryPrompt onConnect={connectLocalLibrary} />
      ) : loadingLibrary ? (
        <WorkingPanel title="Scanning" op="scan_device_library" note="Reading your library from disk." />
      ) : gap.step === "idle" ? (
        <SourcePicker spotify={spotify} includePlaylists={includePlaylists} setIncludePlaylists={setIncludePlaylists} libraryReady={libraryReady} trackCount={tracks.length} />
      ) : gap.step === "fetching" ? (
        <WorkingPanel title="Fetching" op={gap.source === "spotify" ? "spotify_fetch" : "fetch_playlist"} note="Reading the source." />
      ) : gap.step === "matching" ? (
        <WorkingPanel title="Matching" op="match_tracks" note="Fuzzy-matching titles against your local files. You can leave this screen; the run continues in the background." />
      ) : (
        <Results />
      )}

      {gap.error && (
        <div className="p-4 rounded-2xl border border-line flex items-center justify-between gf-in" style={{ background: "var(--errS)" }}>
          <span className="text-[13px] text-err">{gap.error}</span>
          <button onClick={() => gap.reset()} className="btn btn-ghost text-xs">Dismiss</button>
        </div>
      )}
    </div>
  );
}

function ConnectLibraryPrompt({ onConnect }: { onConnect: (path: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const browse = async () => {
    setErr(null);
    try {
      const sel = await openDialog({ directory: true, multiple: false, title: "Select your music library folder" });
      if (!sel) return;
      setBusy(true);
      await onConnect(typeof sel === "string" ? sel : String(sel));
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="card gf-in p-[40px] flex flex-col gap-6 max-w-[640px]">
      <div className="font-mono text-[9px] tracking-[.18em] text-brand">STEP ZERO</div>
      <div className="text-[40px] font-display font-extrabold leading-[1.02] tracking-[-0.035em] text-ink">Connect the library you own.</div>
      <p className="text-[14px] leading-[1.6] text-ink2 max-w-[520px]">The gap report compares a streaming source against the music already on your disk. Point Grapefruit at that folder to begin. Nothing is downloaded or written.</p>
      <div>
        <button onClick={browse} disabled={busy} className="btn btn-primary">{busy ? "Connecting..." : "Choose music folder"}</button>
      </div>
      {err && <p className="text-[12px] text-err">{err}</p>}
    </div>
  );
}

function WorkingPanel({ title, op, note }: { title: string; op: string; note: string }) {
  const p = useProgress(op);
  return (
    <div className="card gf-in p-[40px] flex flex-col gap-5">
      <div className="flex items-baseline gap-4 flex-wrap">
        <div className="text-[44px] font-display font-extrabold tracking-[-0.035em] leading-none text-ink">{title}</div>
        {p.total > 0 && <div className="font-mono text-[12px] text-ink2">{p.current.toLocaleString()} / {p.total.toLocaleString()} tracks</div>}
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
        {p.total > 0
          ? <div className="h-full rounded-full" style={{ width: `${p.percent}%`, background: "var(--brand)" }} />
          : <div className="h-full progress-indeterminate rounded-full" style={{ background: "var(--brand)" }} />}
      </div>
      {p.message && <div className="font-mono text-[10px] text-ink2 truncate">{p.message}</div>}
      <div className="p-3.5 rounded-xl panel2 text-[12px] text-ink2">{note}</div>
    </div>
  );
}

/* ── source picker ───────────────────────────── */
function SourcePicker({ spotify, includePlaylists, setIncludePlaylists, libraryReady, trackCount }: {
  spotify: SpotifyStatus | null; includePlaylists: boolean; setIncludePlaylists: (v: boolean) => void; libraryReady: boolean; trackCount: number;
}) {
  const { source, setSource, url, setUrl, runUrlGap, runSpotifyGap } = useGapStore();
  const urlValid = url.includes("spotify.com/") || url.includes("music.apple.com/");
  const connected = spotify?.connected ?? false;
  const [showAppleHelp, setShowAppleHelp] = useState(false);

  const card = (key: "url" | "spotify", tag: string, title: string, desc: string) => (
    <button onClick={() => setSource(key)}
      className="p-5 rounded-2xl panel2 text-left flex flex-col gap-2.5 transition-colors"
      style={source === key ? { borderColor: "var(--brandLine)", boxShadow: "inset 0 0 0 1px var(--brandLine)" } : undefined}>
      <div className="flex items-center gap-2.5">
        <span className="icon-box icon-box-md icon-box-emerald font-mono text-[10px] font-semibold">{tag}</span>
        <span className="text-[14px] font-bold text-ink">{title}</span>
        {key === "spotify" && connected && <span className="badge badge-emerald">Connected</span>}
      </div>
      <p className="text-[12px] leading-[1.55] text-ink2">{desc}</p>
    </button>
  );

  return (
    <>
      <div className="card gf-in p-[40px] flex flex-col gap-6">
        <div className="flex flex-col gap-3 max-w-[560px]">
          <div className="font-mono text-[9px] tracking-[.18em] text-brand">STEP ONE</div>
          <div className="text-[40px] font-display font-extrabold leading-[1.02] tracking-[-0.035em] text-ink">Pick a source to compare against.</div>
          <div className="text-[14px] leading-[1.6] text-ink2">Grapefruit reads the source, matches it against the {trackCount.toLocaleString()} tracks you own, and lists only what is missing. Nothing is downloaded and nothing is written.</div>
        </div>
        <div className="grid gap-3.5 max-w-[720px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {card("url", "URL", "Paste a playlist link", "Any public Spotify or Apple Music playlist. No account needed.")}
          {card("spotify", "SP", "Your full Spotify library", connected && spotify?.user_name ? `Connected as ${spotify.user_name} · liked songs and every playlist.` : "Liked songs and every playlist you follow. One-time setup in Settings.")}
        </div>
      </div>

      {source === "url" && (
        <div className="card p-5 gf-in">
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && urlValid && runUrlGap(url)}
            placeholder="https://open.spotify.com/playlist/..." className="input text-center py-3" autoFocus />
          <button onClick={() => runUrlGap(url)} disabled={!urlValid || !libraryReady} className="btn btn-primary w-full mt-3 py-2.5">Find missing songs</button>
          {!libraryReady && <p className="text-[11px] text-amber mt-2 text-center">Your library is still scanning.</p>}
          <div className="mt-4 pt-3 border-t border-line">
            <button onClick={() => setShowAppleHelp((v) => !v)} className="flex items-center gap-1.5 font-mono text-[10px] text-ink3 hover:text-ink2 transition-colors">
              <span style={{ transform: showAppleHelp ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>▸</span>
              COMPARE YOUR WHOLE APPLE MUSIC LIBRARY
            </button>
            {showAppleHelp && (
              <ol className="text-[12px] text-ink2 space-y-1.5 list-decimal list-inside leading-relaxed mt-3 pl-1">
                <li>In Apple Music, make a new playlist (e.g. &ldquo;My Library&rdquo;).</li>
                <li>Open your <strong>Songs</strong>, select all, and add them to it.</li>
                <li>Right-click the playlist → <strong>Share</strong> → <strong>Copy Link</strong> (make it public if asked).</li>
                <li>Paste that link above and run the report.</li>
              </ol>
            )}
          </div>
        </div>
      )}

      {source === "spotify" && (connected ? (
        <div className="card p-5 gf-in">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[13px] font-semibold text-ink">{spotify?.user_name ? `Connected as ${spotify.user_name}` : "Connected"}</p>
              <p className="font-mono text-[9px] text-ink3 mt-1">LIKED SONGS{includePlaylists ? " + ALL PLAYLISTS" : " ONLY"} · DEDUPED</p>
            </div>
            <button onClick={() => setIncludePlaylists(!includePlaylists)} title="Include playlists"
              className="relative w-10 h-5 rounded-full transition-colors" style={{ background: includePlaylists ? "var(--emer)" : "var(--panel2)" }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all" style={{ background: "#fff", left: includePlaylists ? "22px" : "2px" }} />
            </button>
          </div>
          <button onClick={() => runSpotifyGap(includePlaylists)} disabled={!libraryReady} className="btn btn-primary w-full py-2.5">Analyze my library</button>
        </div>
      ) : (
        <div className="card p-5 gf-in text-center">
          <p className="text-[13px] text-ink2 leading-relaxed mb-4">Connect your Spotify account to analyze your whole library. A one-time setup in Settings.</p>
          <Link to="/settings" className="btn btn-secondary text-xs">Connect Spotify in Settings →</Link>
        </div>
      ))}
    </>
  );
}

/* ── results ─────────────────────────────────── */
function Results() {
  const { metadata, matchResults, filter, setFilter, reset } = useGapStore();
  const addToast = useToastStore((s) => s.addToast);

  const missing = useMemo(() => matchResults.filter(isMissing), [matchResults]);
  const uncertain = useMemo(() => matchResults.filter(isUncertain), [matchResults]);
  const have = matchResults.length - missing.length - uncertain.length;
  const coverage = matchResults.length ? Math.round((have / matchResults.length) * 1000) / 10 : 0;
  const visible = filter === "missing" ? missing : filter === "uncertain" ? uncertain : matchResults;

  const copyList = async () => {
    if (!visible.length) return;
    await navigator.clipboard.writeText(buildTxt(visible));
    addToast("success", `Copied ${visible.length} tracks to clipboard`);
  };
  const exportFile = async () => {
    if (!visible.length) return;
    const base = (metadata?.name ?? "gap-report").replace(/[<>:"/\\|?*]/g, "");
    const path = await saveDialog({ title: "Export Track List", defaultPath: `${base} - ${filter}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }, { name: "Text", extensions: ["txt"] }] });
    if (!path) return;
    await rpcCall("write_text_file", { path, content: path.toLowerCase().endsWith(".txt") ? buildTxt(visible) : buildCsv(visible) });
    addToast("success", `Exported ${visible.length} tracks`);
  };

  const chips: { key: GapFilter; label: string; count: number }[] = [
    { key: "missing", label: "Missing", count: missing.length },
    { key: "uncertain", label: "Uncertain", count: uncertain.length },
    { key: "all", label: "All", count: matchResults.length },
  ];

  const [skQuery, setSkQuery] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="card gf-in p-[26px] grid gap-[26px]" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,320px)" }}>
        <div className="flex flex-col gap-4 min-w-0">
          <div className="font-mono text-[9px] tracking-[.18em] text-brand truncate">GAP REPORT · {(metadata?.name ?? "SOURCE").toUpperCase()} → LOCAL</div>
          <div className="flex items-baseline gap-4 flex-wrap">
            <div className="font-display font-extrabold leading-[0.82] tracking-[-0.05em] text-ink" style={{ fontSize: "clamp(56px, 7vw, 92px)" }}>{missing.length}</div>
            <div className="text-[24px] font-semibold tracking-[-0.02em] text-ink2">to find</div>
          </div>
          <div className="text-[13px] leading-[1.6] text-ink2 max-w-[460px]">
            Out of {matchResults.length.toLocaleString()} tracks in <span className="text-ink font-semibold">{metadata?.name ?? "the source"}</span>, {have.toLocaleString()} already exist in your library{uncertain.length ? `, ${uncertain.length} matched under a different filename` : ""}.
          </div>
          <div className="flex gap-2 flex-wrap pt-0.5">
            {chips.map((c) => {
              const on = filter === c.key;
              return (
                <button key={c.key} onClick={() => setFilter(c.key)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-full text-[12px] font-semibold transition-colors"
                  style={on ? { background: "var(--ink)", color: "var(--bg)" } : { border: "1px solid var(--line)", color: "var(--ink2)" }}>
                  {c.label}
                  <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-full" style={on ? { background: "rgba(255,255,255,.18)" } : { background: "var(--panel2)", color: "var(--ink3)" }}>{c.count}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-3.5 pl-[26px] border-l border-line min-w-0">
          <div className="font-mono text-[9px] tracking-[.14em] text-ink3">SOURCE</div>
          <div className="text-[13px] font-semibold truncate text-ink">{metadata?.name ?? "Gap Report"}</div>
          <div className="font-mono text-[9px] text-ink3">{matchResults.length.toLocaleString()} TRACKS</div>
          <div className="h-px" style={{ background: "var(--line)" }} />
          <div className="flex items-center gap-2.5">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
              <div className="h-full rounded-full" style={{ width: `${coverage}%`, background: "var(--emer)" }} />
            </div>
            <div className="font-mono text-[9px] text-ink2">{coverage}%</div>
          </div>
          <div className="font-mono text-[9px] text-ink3">COVERAGE OF SOURCE</div>
          <div className="flex-1" />
          <div className="flex gap-2">
            <button onClick={copyList} disabled={!visible.length} className="btn btn-secondary flex-1 text-[12px] py-2">Copy list</button>
            <button onClick={exportFile} disabled={!visible.length} className="btn btn-secondary flex-1 text-[12px] py-2">Export</button>
          </div>
          <button onClick={reset} className="btn btn-primary text-[12px] py-2.5">New report</button>
        </div>
      </div>

      <div className="card overflow-hidden gf-in">
        <div className="grid gap-3.5 px-5 py-3 border-b border-line panel2 font-mono text-[8px] font-semibold tracking-[.14em] text-ink3" style={{ gridTemplateColumns: "34px minmax(0,1.15fr) minmax(0,.9fr) minmax(0,.8fr) minmax(0,1fr)" }}>
          <div></div><div>TRACK</div><div>ARTIST</div><div>ALBUM</div><div>LOCAL MATCH</div>
        </div>
        <div className="max-h-[46vh] overflow-y-auto">
          {visible.length === 0 ? (
            <p className="text-center text-[13px] text-ink3 py-10">{filter === "missing" ? "No missing tracks in this report." : "Nothing in this bucket."}</p>
          ) : visible.map((r, i) => <GapRow key={i} result={r} onFind={setSkQuery} />)}
        </div>
        <div className="px-5 py-3 flex items-center gap-3 font-mono text-[9px] text-ink3">
          <div>SHOWING {visible.length} OF {matchResults.length}</div>
          <div className="flex-1" />
        </div>
      </div>

      {skQuery !== null && <SoulseekSearchModal initialQuery={skQuery} onClose={() => setSkQuery(null)} />}
    </div>
  );
}

function GapRow({ result, onFind }: { result: MatchResult; onFind: (q: string) => void }) {
  const pt = result.playlist_track;
  const lt = result.best_match?.local_track;
  const tone = isMissing(result) ? "err" : isUncertain(result) ? "amber" : "emer";
  const badge = isMissing(result) ? "MISSING" : isUncertain(result) ? "UNCERTAIN" : "MATCHED";
  return (
    <div className="grid gap-3.5 items-center px-5 py-[11px] border-b border-line2 text-[13px] transition-colors hover:bg-panel2" style={{ gridTemplateColumns: "34px minmax(0,1.15fr) minmax(0,.9fr) minmax(0,.8fr) minmax(0,1fr)" }}>
      <div className="w-[7px] h-[7px] rounded-full" style={{ background: `var(--${tone})` }} />
      <div className="font-medium truncate text-ink">{pt.title}</div>
      <div className="text-ink2 truncate">{pt.artist}</div>
      <div className="text-ink3 truncate">{pt.album}</div>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`badge badge-${tone === "emer" ? "emerald" : tone}`}>{badge}</span>
        <span className="font-mono text-[9px] text-ink3 truncate">{lt ? `${lt.artist} - ${lt.title}` : "NOT IN LIBRARY"}</span>
        {isMissing(result) && (
          <button onClick={() => onFind(`${pt.artist} ${pt.title}`)} title="Find on Soulseek" className="ml-auto shrink-0 font-mono text-[9px] font-bold text-brand hover:opacity-80 transition-opacity">FIND ↗</button>
        )}
      </div>
    </div>
  );
}
