import { useNavigate } from "react-router-dom";
import { useDeviceStore } from "../stores/deviceStore";

export default function Welcome() {
  const navigate = useNavigate();
  const { selectedDevice, scanning, scanForDevices } = useDeviceStore();

  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-100px)] max-w-2xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="w-16 h-16 rounded-2xl bg-gf flex items-center justify-center mx-auto mb-5 shadow-lg shadow-gf/25 pulse-glow">
          <span className="text-white text-2xl font-black">G</span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-t">
          Welcome to <span className="text-gf">Grapefruit</span>
        </h1>
        <p className="mt-3 text-t-secondary text-sm leading-relaxed max-w-md mx-auto">
          Your all-in-one music manager for iPod, Rockbox, and Plex.
          Import playlists, sync tracks, and keep everything in harmony.
        </p>
      </div>

      {/* Device card */}
      {selectedDevice ? (
        <div className="w-full max-w-md mb-10">
          <div className="card p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-ok-muted flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 text-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-t">{selectedDevice.label || "iPod"}</p>
              <p className="text-xs text-t-secondary">{selectedDevice.model || "Device connected and ready"}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-md mb-10">
          <button
            onClick={() => scanForDevices()}
            disabled={scanning}
            className="w-full card p-5 flex items-center gap-4 hover:border-b-light transition-all group cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-bg-surface flex items-center justify-center shrink-0 group-hover:bg-bg-elevated transition-colors">
              <svg className="w-6 h-6 text-t-muted group-hover:text-gf transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-t group-hover:text-gf transition-colors">
                {scanning ? "Scanning for devices..." : "Connect your iPod"}
              </p>
              <p className="text-xs text-t-secondary">Click to scan for connected devices</p>
            </div>
          </button>
        </div>
      )}

      {/* Quick actions */}
      <div className="w-full max-w-lg grid grid-cols-2 gap-3">
        <ActionCard
          title="Import Playlist"
          desc="From Spotify or Apple Music"
          icon={<ImportIcon />}
          onClick={() => navigate("/import")}
        />
        <ActionCard
          title="Browse Library"
          desc="View tracks on your device"
          icon={<LibraryIcon />}
          onClick={() => navigate("/library")}
          disabled={!selectedDevice}
        />
        <ActionCard
          title="Sync to Plex"
          desc="Push playlists to your server"
          icon={<PlexIcon />}
          onClick={() => navigate("/plex-sync")}
        />
        <ActionCard
          title="Sync Music"
          desc="Copy music to your device"
          icon={<SyncIcon />}
          onClick={() => navigate("/sync")}
          disabled={!selectedDevice}
        />
      </div>
    </div>
  );
}

function ActionCard({ title, desc, icon, onClick, disabled }: {
  title: string; desc: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="card p-4 text-left flex items-start gap-3.5 hover:border-gf/30 hover:bg-bg-raised transition-all group disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-b"
    >
      <div className="w-9 h-9 rounded-lg bg-bg-surface flex items-center justify-center shrink-0 group-hover:bg-gf-glow transition-colors">
        {icon}
      </div>
      <div>
        <p className="text-[13px] font-semibold text-t group-hover:text-gf transition-colors">{title}</p>
        <p className="text-[11px] text-t-secondary mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </button>
  );
}

function ImportIcon() {
  return <svg className="w-4 h-4 text-t-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>;
}
function LibraryIcon() {
  return <svg className="w-4 h-4 text-t-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" /></svg>;
}
function PlexIcon() {
  return <svg className="w-4 h-4 text-t-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" /></svg>;
}
function SyncIcon() {
  return <svg className="w-4 h-4 text-t-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.015 4.356v4.992" /></svg>;
}
