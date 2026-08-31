import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useImportStore } from "../stores/importStore";
import { useDeviceStore } from "../stores/deviceStore";
import { ProgressBar } from "../components/ProgressBar";
import { MatchRow } from "../components/MatchRow";
import { useProgress } from "../hooks/useProgress";

type Step = "url" | "fetching" | "matching" | "results" | "saving" | "done";

const LABELS = ["Paste URL", "Fetch", "Match", "Save"];
function stepIndex(step: Step): number {
  if (step === "url") return 0;
  if (step === "fetching") return 1;
  if (step === "matching") return 2;
  return 3;
}

function StepIndicator({ currentStep, source }: { currentStep: Step; source: string }) {
  const idx = stepIndex(currentStep);
  return (
    <div className="card p-4 flex items-center gap-0 flex-wrap gf-in">
      {LABELS.map((label, i) => {
        const done = i < idx, active = i === idx;
        return (
          <div key={label} className="flex items-center gap-2.5 pr-[18px]">
            <div className="w-6 h-6 rounded-full flex items-center justify-center font-mono text-[10px] font-semibold shrink-0"
              style={active ? { background: "var(--brandBtn)", color: "var(--brandBtnF)" } : done ? { background: "var(--emerS)", color: "var(--emer)" } : { border: "1px solid var(--line)", color: "var(--ink3)" }}>
              {done ? "✓" : i + 1}
            </div>
            <div className="text-[12px] whitespace-nowrap" style={active ? { fontWeight: 700, color: "var(--ink)" } : { fontWeight: 500, color: "var(--ink3)" }}>{label}</div>
            {i < LABELS.length - 1 && <div className="w-[26px] h-px" style={{ background: "var(--line)" }} />}
          </div>
        );
      })}
      <div className="flex-1" />
      {source && <div className="font-mono text-[9px] text-ink3 truncate">SOURCE · {source.toUpperCase()}</div>}
    </div>
  );
}

function UrlStep() {
  const [url, setUrl] = useState("");
  const { fetchFromUrl } = useImportStore();
  const valid = url.includes("spotify.com/") || url.includes("music.apple.com/");
  return (
    <div className="card gf-in p-[40px] flex flex-col gap-5 max-w-[640px]">
      <div className="font-mono text-[9px] tracking-[.18em] text-brand">STEP ONE</div>
      <div className="text-[32px] font-display font-extrabold tracking-[-0.035em] leading-tight text-ink">Paste a playlist to import.</div>
      <p className="text-[13px] leading-[1.6] text-ink2">A public Spotify or Apple Music link. Grapefruit fetches it, matches every track to a local file, and writes an M3U8 to your device.</p>
      <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid && fetchFromUrl(url)}
        placeholder="https://open.spotify.com/playlist/..." className="input py-3" autoFocus />
      <div><button onClick={() => fetchFromUrl(url)} disabled={!valid} className="btn btn-primary">Fetch playlist</button></div>
    </div>
  );
}

function WorkingStep({ title, op, ready, onGo, goLabel }: { title: string; op: string; ready?: boolean; onGo?: () => void; goLabel?: string }) {
  const p = useProgress(op);
  return (
    <div className="card gf-in p-[40px] flex flex-col gap-5">
      <div className="text-[32px] font-display font-extrabold tracking-[-0.035em] leading-none text-ink">{title}</div>
      {ready ? (
        <div><button onClick={onGo} className="btn btn-primary">{goLabel}</button></div>
      ) : (
        <>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
            {p.total > 0 ? <div className="h-full rounded-full" style={{ width: `${p.percent}%`, background: "var(--brand)" }} /> : <div className="h-full progress-indeterminate rounded-full" style={{ background: "var(--brand)" }} />}
          </div>
          {p.total > 0 && <div className="font-mono text-[10px] text-ink2">{p.current.toLocaleString()} / {p.total.toLocaleString()}</div>}
        </>
      )}
    </div>
  );
}

function MatchingStep() {
  const { sourceTracks, matchTracks, loading, metadata } = useImportStore();
  const { selectedDevice } = useDeviceStore();
  useEffect(() => {
    if (selectedDevice && sourceTracks.length > 0 && !loading) matchTracks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (loading) return <WorkingStep title="Matching" op="match_tracks" />;
  return <WorkingStep title={`Fetched ${sourceTracks.length} tracks${metadata?.name ? ` from ${metadata.name}` : ""}`} op="match_tracks" ready onGo={() => matchTracks()} goLabel="Match tracks" />;
}

function ResultsStep() {
  const { metadata, matchResults, savePlaylist, loading } = useImportStore();
  const [name, setName] = useState(metadata?.name ?? "");
  const matched = matchResults.filter((r) => ["matched", "confirmed", "manual"].includes(r.status)).length;
  const uncertain = matchResults.filter((r) => r.status === "uncertain").length;
  const missing = matchResults.filter((r) => r.status === "missing").length;
  const saveable = matched + uncertain;

  return (
    <div className="grid gap-[18px] items-start" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,300px)" }}>
      <div className="card overflow-hidden gf-in">
        <div className="px-[22px] py-4 flex items-baseline gap-3.5 flex-wrap border-b border-line">
          <div className="text-[21px] font-bold tracking-[-0.025em] text-ink">Review matches</div>
          <div className="font-mono text-[9px] text-ink3">{matched} MATCHED · {uncertain} UNCERTAIN · {missing} MISSING</div>
        </div>
        <div className="grid gap-3 px-[22px] py-[11px] panel2 border-b border-line font-mono text-[8px] font-semibold tracking-[.14em] text-ink3" style={{ gridTemplateColumns: "minmax(0,1fr) 22px minmax(0,1fr) 74px 96px" }}>
          <div>SOURCE TRACK</div><div></div><div>LOCAL FILE</div><div>CONF</div><div className="text-right">STATUS</div>
        </div>
        <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
          {matchResults.map((r, i) => <MatchRow key={i} result={r} index={i} />)}
        </div>
      </div>

      <div className="card p-5 flex flex-col gap-3.5 gf-in">
        <div className="font-mono text-[9px] tracking-[.14em] text-ink3">SAVE AS</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name"
          className="px-3.5 py-2.5 rounded-xl panel2 text-[13px] font-semibold text-ink outline-none" style={{ border: "1.5px solid var(--brandLine)" }} />
        <div className="font-mono text-[9px] leading-[1.6] text-ink3">WRITES {(name || "PLAYLIST").toUpperCase()}.M3U8 TO YOUR DEVICE</div>
        <div className="h-px" style={{ background: "var(--line)" }} />
        <div className="flex flex-col gap-2.5">
          <Tally color="emer" label={`${matched} tracks resolved`} />
          <Tally color="amber" label={`${uncertain} need your call`} />
          <Tally color="err" label={`${missing} not in your library`} />
        </div>
        <button onClick={() => savePlaylist(name)} disabled={!name.trim() || saveable === 0 || loading} className="btn btn-primary py-3">{loading ? "Saving..." : `Save playlist · ${saveable}`}</button>
        <div className="font-mono text-[8px] leading-[1.6] text-ink3 text-center">MISSING TRACKS ARE LEFT OUT, NOT GUESSED</div>
      </div>
    </div>
  );
}

function Tally({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: `var(--${color})` }} />
      <span className="text-[12px] text-ink2 flex-1">{label}</span>
    </div>
  );
}

function DoneStep() {
  const navigate = useNavigate();
  const { metadata, reset } = useImportStore();
  const { refreshPlaylists } = useDeviceStore();
  const savedCount = useImportStore((s) => s.savedCount);
  const playlistName = metadata?.name ?? "playlist";
  const handleView = () => { refreshPlaylists(); navigate(`/playlists/${encodeURIComponent(playlistName)}`); reset(); };
  return (
    <div className="card gf-in p-[40px] flex flex-col gap-5 max-w-[520px]">
      <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: "var(--emerS)", color: "var(--emer)" }}>
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      </div>
      <div className="text-[28px] font-display font-extrabold tracking-[-0.035em] leading-tight text-ink">Playlist saved.</div>
      <p className="text-[13px] text-ink2">{savedCount} track{savedCount !== 1 ? "s" : ""} written to &ldquo;{playlistName}&rdquo;.</p>
      <div className="flex gap-3">
        <button onClick={handleView} className="btn btn-primary">View playlist</button>
        <button onClick={() => reset()} className="btn btn-secondary">Import another</button>
      </div>
    </div>
  );
}

export default function ImportFlow() {
  const store = useImportStore();
  const source = store.metadata ? `${store.metadata.name} · ${store.sourceTracks.length} TRACKS` : "";

  return (
    <div className="flex flex-col gap-[18px] max-w-[1600px]">
      {store.step !== "url" && store.step !== "done" && <StepIndicator currentStep={store.step} source={source} />}
      {store.step === "url" && <UrlStep />}
      {store.step === "fetching" && <WorkingStep title={store.metadata?.name ? `Fetching ${store.metadata.name}` : "Fetching playlist"} op="fetch_playlist" />}
      {store.step === "matching" && <MatchingStep />}
      {(store.step === "results" || store.step === "saving") && <ResultsStep />}
      {store.step === "done" && <DoneStep />}

      {store.error && (
        <div className="p-4 rounded-xl border border-line flex items-center justify-between" style={{ background: "var(--errS)" }}>
          <span className="text-[13px] text-err">{store.error}</span>
          <button onClick={() => store.reset()} className="btn btn-ghost text-xs">Try again</button>
        </div>
      )}
    </div>
  );
}
