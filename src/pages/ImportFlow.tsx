import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useImportStore } from "../stores/importStore";
import { useDeviceStore } from "../stores/deviceStore";
import { ProgressBar } from "../components/ProgressBar";
import { MatchRow } from "../components/MatchRow";
import { useProgress } from "../hooks/useProgress";

export default function ImportFlow() {
  const navigate = useNavigate();
  const store = useImportStore();
  const { refreshPlaylists } = useDeviceStore();
  const fetchProgress = useProgress("fetch_playlist");
  const matchProgress = useProgress("match_tracks");

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-t">Import Playlist</h1>
        <p className="text-[13px] text-t-secondary mt-1">
          Paste a Spotify or Apple Music URL to import a playlist
        </p>
      </div>

      {/* Step indicator */}
      {store.step !== "url" && store.step !== "done" && (
        <div className="flex items-center gap-2 mb-6">
          <StepDot active={store.step === "fetching"} done={["matching", "results", "saving"].includes(store.step)} label="Fetch" />
          <StepLine />
          <StepDot active={store.step === "matching"} done={["results", "saving"].includes(store.step)} label="Match" />
          <StepLine />
          <StepDot active={store.step === "results" || store.step === "saving"} done={false} label="Save" />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {store.step === "url" && <UrlStep />}
        {store.step === "fetching" && <LoadingStep label="Fetching playlist..." progress={fetchProgress} name={store.metadata?.name} />}
        {store.step === "matching" && store.loading && <LoadingStep label="Matching tracks..." progress={matchProgress} />}
        {(store.step === "results" || (store.step === "matching" && !store.loading)) && <ResultsStep />}
        {store.step === "saving" && <LoadingStep label="Saving to device..." progress={{ percent: 0, current: 0, total: 0 }} />}
        {store.step === "done" && (
          <DoneStep
            onView={() => { const n = store.metadata?.name ?? "playlist"; refreshPlaylists(); navigate(`/playlist/${encodeURIComponent(n)}`); store.reset(); }}
            onAnother={() => store.reset()}
          />
        )}
      </div>

      {store.error && (
        <div className="mt-4 p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err">
          {store.error}
        </div>
      )}
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
        done ? "bg-ok text-bg-base" : active ? "bg-gf text-white" : "bg-bg-surface text-t-muted"
      }`}>
        {done ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : null}
      </div>
      <span className={`text-[11px] font-medium ${active ? "text-gf" : done ? "text-ok" : "text-t-muted"}`}>{label}</span>
    </div>
  );
}

function StepLine() {
  return <div className="w-8 h-px bg-b mx-1" />;
}

function UrlStep() {
  const [url, setUrl] = useState("");
  const { fetchFromUrl } = useImportStore();
  const valid = url.includes("spotify.com/") || url.includes("music.apple.com/");

  return (
    <div className="max-w-xl space-y-5">
      <div className="card p-6 space-y-4">
        <label className="block text-[13px] font-semibold text-t">Playlist URL</label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && valid && fetchFromUrl(url)}
          placeholder="https://open.spotify.com/playlist/... or https://music.apple.com/..."
          className="input"
          autoFocus
        />
        <div className="flex items-center gap-3">
          <button onClick={() => fetchFromUrl(url)} disabled={!valid} className="btn btn-primary">
            Fetch Playlist
          </button>
          <span className="text-[11px] text-t-secondary">Supports Spotify and Apple Music URLs</span>
        </div>
      </div>
    </div>
  );
}

function LoadingStep({ label, progress, name }: { label: string; progress: { percent: number; current: number; total: number }; name?: string }) {
  return (
    <div className="max-w-xl">
      <div className="card p-6 space-y-4">
        <p className="text-[13px] font-semibold text-t">{name ? `${label} "${name}"` : label}</p>
        <ProgressBar percent={progress.percent} sublabel={progress.total > 0 ? `${progress.current} / ${progress.total}` : undefined} />
      </div>
    </div>
  );
}

function ResultsStep() {
  const { metadata, matchResults, sourceTracks, matchTracks, savePlaylist, loading } = useImportStore();
  const [name, setName] = useState(metadata?.name ?? "");

  const matched = matchResults.filter((r) => ["matched", "confirmed", "manual"].includes(r.status)).length;
  const uncertain = matchResults.filter((r) => r.status === "uncertain").length;
  const missing = matchResults.filter((r) => r.status === "missing").length;

  if (matchResults.length === 0 && sourceTracks.length > 0) {
    return (
      <div className="max-w-xl space-y-4">
        <div className="card p-6">
          <p className="text-[13px] font-semibold text-t">
            Fetched {sourceTracks.length} tracks from "{metadata?.name}"
          </p>
          <p className="text-[11px] text-t-muted mt-1">Ready to match against your device library</p>
        </div>
        <button onClick={() => matchTracks()} className="btn btn-primary">Match Tracks</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 flex-wrap">
        <h2 className="text-sm font-bold text-t">{metadata?.name}</h2>
        <div className="flex gap-3 text-[12px] font-medium">
          <span className="text-ok">{matched} matched</span>
          {uncertain > 0 && <span className="text-warn">{uncertain} uncertain</span>}
          {missing > 0 && <span className="text-err">{missing} missing</span>}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" className="input w-48 py-2 text-[13px]" />
          <button onClick={() => savePlaylist(name)} disabled={!name.trim() || matched === 0 || loading} className="btn btn-primary">
            Save to Device
          </button>
        </div>
      </div>
      <div className="card overflow-hidden">
        <div className="max-h-[calc(100vh-340px)] overflow-y-auto">
          {matchResults.map((r, i) => <MatchRow key={i} result={r} index={i} />)}
        </div>
      </div>
    </div>
  );
}

function DoneStep({ onView, onAnother }: { onView: () => void; onAnother: () => void }) {
  return (
    <div className="max-w-sm mx-auto text-center py-16 space-y-6">
      <div className="w-16 h-16 rounded-2xl bg-ok-muted flex items-center justify-center mx-auto">
        <svg className="w-8 h-8 text-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div>
        <p className="text-lg font-bold text-t">Playlist saved!</p>
        <p className="text-[13px] text-t-secondary mt-1">Your playlist has been written to the device.</p>
      </div>
      <div className="flex gap-3 justify-center">
        <button onClick={onView} className="btn btn-primary">View Playlist</button>
        <button onClick={onAnother} className="btn btn-secondary">Import Another</button>
      </div>
    </div>
  );
}
