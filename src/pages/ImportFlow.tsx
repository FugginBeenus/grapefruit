import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useImportStore } from "../stores/importStore";
import { useDeviceStore } from "../stores/deviceStore";
import { ProgressBar } from "../components/ProgressBar";
import { MatchRow } from "../components/MatchRow";
import { useProgress } from "../hooks/useProgress";

type Step = "url" | "fetching" | "matching" | "results" | "saving" | "done";

const STEPS: { key: Step; label: string; num: string; color: string; activeBg: string }[] = [
  { key: "url", label: "Paste URL", num: "1", color: "text-pink", activeBg: "bg-pink" },
  { key: "fetching", label: "Fetch", num: "2", color: "text-cyan", activeBg: "bg-cyan" },
  { key: "matching", label: "Match", num: "3", color: "text-amber", activeBg: "bg-amber" },
  { key: "results", label: "Save", num: "4", color: "text-emerald", activeBg: "bg-emerald" },
];

function stepIndex(step: Step): number {
  if (step === "url") return 0;
  if (step === "fetching") return 1;
  if (step === "matching") return 2;
  if (step === "saving" || step === "results") return 3;
  return 4; // done
}

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const idx = stepIndex(currentStep);

  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEPS.map((s, i) => {
        const isActive = i === idx;
        const isComplete = i < idx;
        const isUpcoming = i > idx;
        return (
          <div key={s.key} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                isComplete ? "bg-emerald text-bg-base" : isActive ? `${s.activeBg} text-white` : "bg-bg-surface text-t-muted"
              }`}>
                {isComplete ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : s.num}
              </div>
              <span className={`text-[12px] font-medium ${
                isComplete ? "text-emerald" : isActive ? s.color : "text-t-muted"
              }`}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-12 h-px mx-3 ${isComplete ? "bg-emerald" : isUpcoming ? "bg-b" : s.activeBg}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function UrlStep() {
  const [url, setUrl] = useState("");
  const { fetchFromUrl } = useImportStore();
  const valid = url.includes("spotify.com/") || url.includes("music.apple.com/");

  return (
    <div className="max-w-md mx-auto mt-16">
      {/* Decorative icon */}
      <div className="flex justify-center mb-8">
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(244, 114, 182, 0.15) 0%, rgba(167, 139, 250, 0.08) 100%)", boxShadow: "0 0 40px rgba(244, 114, 182, 0.1)" }}>
            <svg className="w-8 h-8 text-pink/60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
          </div>
        </div>
      </div>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && valid && fetchFromUrl(url)}
        placeholder="https://open.spotify.com/playlist/..."
        className="input text-center text-base py-3.5"
        autoFocus
      />
      <button onClick={() => fetchFromUrl(url)} disabled={!valid} className="btn btn-primary w-full mt-4 py-3">
        Fetch Playlist
      </button>
      <p className="text-[11px] text-t-muted mt-3 text-center">Supports Spotify and Apple Music URLs</p>
    </div>
  );
}

function FetchingStep() {
  const { metadata } = useImportStore();
  const progress = useProgress("fetch_playlist");
  return (
    <div className="max-w-md mx-auto mt-16 text-center">
      <div className="card p-6 space-y-4">
        <p className="text-sm font-semibold text-t">
          {metadata?.name ? `Fetching "${metadata.name}"...` : "Fetching playlist..."}
        </p>
        <ProgressBar percent={progress.percent} sublabel={progress.total > 0 ? `${progress.current} / ${progress.total}` : undefined} />
      </div>
    </div>
  );
}

function MatchingStep() {
  const { sourceTracks, matchTracks, loading, metadata } = useImportStore();
  const { selectedDevice } = useDeviceStore();
  const progress = useProgress("match_tracks");

  // Auto-match on mount if device is connected and not already loading
  useEffect(() => {
    if (selectedDevice && sourceTracks.length > 0 && !loading) {
      matchTracks();
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="max-w-md mx-auto mt-16 text-center">
        <div className="card p-6 space-y-4">
          <p className="text-sm font-semibold text-t">Matching {sourceTracks.length} tracks...</p>
          <ProgressBar percent={progress.percent} sublabel={progress.total > 0 ? `${progress.current} / ${progress.total}` : undefined} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-16 text-center">
      <div className="card p-6">
        <p className="text-sm font-semibold text-t">
          Fetched {sourceTracks.length} tracks{metadata?.name ? ` from "${metadata.name}"` : ""}
        </p>
        <p className="text-[11px] text-t-muted mt-1 mb-4">Ready to match against your device library</p>
        <button onClick={() => matchTracks()} className="btn btn-primary">Match Tracks</button>
      </div>
    </div>
  );
}

function ResultsStep() {
  const { metadata, matchResults, savePlaylist, loading } = useImportStore();
  const [name, setName] = useState(metadata?.name ?? "");

  const matched = matchResults.filter((r) => ["matched", "confirmed", "manual"].includes(r.status)).length;
  const uncertain = matchResults.filter((r) => r.status === "uncertain").length;
  const missing = matchResults.filter((r) => r.status === "missing").length;

  return (
    <div className="flex flex-col gap-4">
      {/* Results header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-t">{metadata?.name ?? "Playlist"}</h2>
          <div className="flex gap-2 mt-2">
            <span className="badge badge-emerald">{matched} matched</span>
            {uncertain > 0 && <span className="badge badge-amber">{uncertain} uncertain</span>}
            {missing > 0 && <span className="badge badge-err">{missing} missing</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Playlist name"
            className="input w-48 py-2 text-[13px]"
          />
          <button
            onClick={() => savePlaylist(name)}
            disabled={!name.trim() || matched === 0 || loading}
            className="btn btn-primary text-xs"
          >
            {loading ? "Saving..." : "Save to Device"}
          </button>
        </div>
      </div>

      {/* Match rows */}
      <div className="card overflow-hidden">
        <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
          {matchResults.map((r, i) => (
            <MatchRow key={i} result={r} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DoneStep() {
  const navigate = useNavigate();
  const { metadata, reset } = useImportStore();
  const { refreshPlaylists } = useDeviceStore();
  const matchResults = useImportStore((s) => s.matchResults);

  const matched = matchResults.filter((r) => ["matched", "confirmed", "manual"].includes(r.status)).length;
  const playlistName = metadata?.name ?? "playlist";

  const handleView = () => {
    refreshPlaylists();
    navigate(`/playlists/${encodeURIComponent(playlistName)}`);
    reset();
  };

  return (
    <div className="max-w-sm mx-auto text-center mt-16 space-y-6">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto" style={{ background: "linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(34, 211, 238, 0.08) 100%)", boxShadow: "0 0 40px rgba(16, 185, 129, 0.12)" }}>
        <svg className="w-8 h-8 text-emerald" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div>
        <p className="text-lg font-bold text-t">Playlist Saved!</p>
        <p className="text-sm text-t-muted mt-1">
          "{playlistName}" -- {matched} tracks saved to your device
        </p>
      </div>
      <div className="flex gap-3 justify-center">
        <button onClick={handleView} className="btn btn-primary">View Playlist</button>
        <button onClick={() => reset()} className="btn btn-secondary">Import Another</button>
      </div>
    </div>
  );
}

export default function ImportFlow() {
  const store = useImportStore();

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <div className="mb-6 pt-2">
        <h1 className="text-3xl font-bold text-t tracking-tight">Import Playlist</h1>
        <p className="text-sm text-t-muted mt-1">Paste a Spotify or Apple Music URL to import a playlist</p>
      </div>

      {/* Step indicator -- hidden on url and done steps */}
      {store.step !== "url" && store.step !== "done" && (
        <StepIndicator currentStep={store.step} />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {store.step === "url" && <UrlStep />}
        {store.step === "fetching" && <FetchingStep />}
        {store.step === "matching" && <MatchingStep />}
        {(store.step === "results" || store.step === "saving") && <ResultsStep />}
        {store.step === "done" && <DoneStep />}
      </div>

      {/* Error */}
      {store.error && (
        <div className="mt-4 p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err flex items-center justify-between">
          <span>{store.error}</span>
          <button onClick={() => store.reset()} className="btn btn-ghost text-xs text-err ml-4">Try Again</button>
        </div>
      )}
    </div>
  );
}
