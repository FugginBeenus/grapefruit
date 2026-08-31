import { NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { usePlexStore } from "../../stores/plexStore";
import { useThemeStore } from "../../stores/themeStore";
import { spotifyGetStatus } from "../../api/spotify";
import { soulseekStatus, type SoulseekStatus } from "../../api/soulseek";
import { open } from "@tauri-apps/plugin-dialog";
import logoUrl from "../../assets/grapefruit_logo.png";
import type { SpotifyStatus } from "../../types/models";

const SAVED_PATH_KEY = "grapefruit:localLibraryPath";
const HUB_NAME_KEY = "grapefruit:hubName";

const SYNC = [
  { to: "/gap", label: "Streaming Gap", tone: "emer" },
  { to: "/sync", label: "Device Sync", tone: "cyan" },
  { to: "/import", label: "Import", tone: "pink" },
];

const fmtGb = (b: number) => {
  const gb = b / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`;
};

const baseName = (p: string) => p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || p;

export function Sidebar() {
  const { selectedDevice, devices, ipod, ipodConnecting, tracks, playlists, scanning, scanForDevices, connectIpod, connectLocalLibrary, connectIpodManual, disconnectIpod, disconnect } = useDeviceStore();
  const loadPlexConfig = usePlexStore((s) => s.loadConfig);
  const plexConfig = usePlexStore((s) => s.config);
  const plexConnected = usePlexStore((s) => s.connected);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [spot, setSpot] = useState<SpotifyStatus | null>(null);
  const [slsk, setSlsk] = useState<SoulseekStatus | null>(null);

  useEffect(() => {
    spotifyGetStatus().then(setSpot).catch(() => {});
    soulseekStatus().then(setSlsk).catch(() => {});
  }, []);
  const [hubName, setHubName] = useState<string>(() => localStorage.getItem(HUB_NAME_KEY) || "");

  const saveHubName = (name: string) => {
    const trimmed = name.trim();
    if (trimmed) {
      localStorage.setItem(HUB_NAME_KEY, trimmed);
      setHubName(trimmed);
    } else {
      localStorage.removeItem(HUB_NAME_KEY);
      setHubName("");
    }
  };

  useEffect(() => {
    loadPlexConfig();
    const savedHub = localStorage.getItem(SAVED_PATH_KEY);
    (async () => {
      await scanForDevices();
      // No device auto-selected but we remember a hub folder: reconnect and
      // rescan it so the library is populated on launch without a re-browse.
      if (savedHub && !useDeviceStore.getState().selectedDevice) {
        try {
          await connectLocalLibrary(savedHub);
        } catch {
          localStorage.removeItem(SAVED_PATH_KEY); // folder gone — stop retrying
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const browse = async () => {
    setFolderError(null);
    try {
      const defaultPath = localStorage.getItem(SAVED_PATH_KEY) || plexConfig?.music_library_path || undefined;
      const selected = await open({ directory: true, multiple: false, title: "Select your music library folder", defaultPath });
      if (!selected) return;
      const folderPath = typeof selected === "string" ? selected : String(selected);
      setConnecting(true);
      await connectLocalLibrary(folderPath);
      localStorage.setItem(SAVED_PATH_KEY, folderPath);
    } catch (e) {
      setFolderError(String(e));
    } finally {
      setConnecting(false);
    }
  };

  const locateDevice = async () => {
    setFolderError(null);
    try {
      const selected = await open({ directory: true, multiple: false, title: "Select your iPod's mounted volume", defaultPath: "/Volumes" });
      if (!selected) return;
      const path = typeof selected === "string" ? selected : String(selected);
      await connectIpodManual(path);
    } catch (e) {
      setFolderError(String(e));
    }
  };

  const isLocal = selectedDevice?.firmware === "local";
  const libraryBytes = tracks.reduce((s, t) => s + (t.file_size || 0), 0);
  const formats = Array.from(new Set(tracks.map((t) => t.format?.toUpperCase()).filter(Boolean))).sort().join(" ");
  const hubPct = libraryBytes + (selectedDevice?.free_bytes ?? 0) > 0
    ? Math.min(100, (libraryBytes / (libraryBytes + (selectedDevice?.free_bytes ?? 0))) * 100) : 0;
  const devPct = ipod && ipod.capacity_bytes > 0
    ? Math.min(100, (ipod.used_bytes / ipod.capacity_bytes) * 100) : 0;
  const detected = devices.filter((d) => String(d.mount_point) !== String(ipod?.mount_point));

  const manage = [
    { to: "/library", label: "Library", tone: "cyan", count: tracks.length },
    { to: "/playlists", label: "Playlists", tone: "violet", count: playlists.length },
    { to: "/tools", label: "Tools", tone: "amber", count: 0 },
    { to: "/settings", label: "Settings", tone: "ink3", count: 0 },
  ];

  return (
    <aside className="w-[244px] shrink-0 flex flex-col overflow-hidden bg-panel border-r border-line select-none">
      {/* Header */}
      <div className="px-3.5 pt-4 pb-3 flex items-center gap-2.5">
        <img src={logoUrl} alt="" className="w-9 h-9 object-contain rounded-[10px] shrink-0" style={{ boxShadow: "0 4px 14px -6px rgba(255,99,71,.5)" }} />
        <div className="font-display text-[21px] font-extrabold tracking-[-0.02em] flex-1 min-w-0 text-ink">Grapefruit</div>
        <button
          onClick={toggleTheme}
          title="Toggle theme"
          className="w-[26px] h-[26px] shrink-0 rounded-lg border border-line flex items-center justify-center hover:border-brandLine hover:bg-brandS transition-colors"
        >
          <span className="w-[11px] h-[11px] rounded-full" style={{ border: "1.6px solid var(--ink2)", background: "linear-gradient(90deg, var(--ink2) 50%, transparent 50%)" }} />
        </button>
      </div>

      {/* Library slot */}
      <div className="px-3 mb-2.5">
        {selectedDevice && isLocal ? (
          <StatusCard
            dot="emer" kicker="THE HUB" state="LOCAL" stateColor="var(--brand)"
            title={hubName || selectedDevice.label || baseName(String(selectedDevice.mount_point))}
            barPct={hubPct} barColor="var(--brand)"
            meta={`${tracks.length.toLocaleString()} TRACKS${formats ? ` · ${formats}` : ""}`}
            onDisconnect={disconnect}
            onRename={saveHubName}
          />
        ) : (
          <div className="panel2 rounded-xl p-3 flex flex-col gap-2.5">
            <div className="font-mono text-[8px] font-semibold tracking-[.14em] text-ink3">LIBRARY</div>
            <button onClick={browse} disabled={connecting} className="btn btn-primary text-[11px] py-2">
              {connecting ? "Connecting..." : "Browse folder"}
            </button>
          </div>
        )}
      </div>

      {/* Device slot */}
      <div className="px-3 mb-3">
        {ipod ? (
          <StatusCard
            dot="cyan" kicker="DEVICE" state="MOUNTED" stateColor="var(--cyan)"
            title={ipod.label || "Device"}
            barPct={devPct} barColor="var(--cyan)"
            meta={`${fmtGb(ipod.used_bytes)} / ${fmtGb(ipod.capacity_bytes)} · ${(ipod.firmware || "").toUpperCase()}`}
            onDisconnect={disconnectIpod}
          />
        ) : (
          <div className="panel2 rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[8px] font-semibold tracking-[.14em] text-ink3">DEVICE</div>
              {(scanning || ipodConnecting) && <span className="font-mono text-[8px] text-ink3">{ipodConnecting ? "CONNECTING…" : "SCANNING…"}</span>}
            </div>
            {detected.map((d) => (
              <button key={String(d.mount_point)} onClick={() => connectIpod(d)} disabled={ipodConnecting} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-panel transition-colors text-left">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--cyan)" }} />
                <span className="text-[12px] text-ink flex-1 min-w-0 truncate">{d.label || d.model || "iPod"}</span>
                <span className="text-[10px] font-bold text-brand shrink-0">Connect</span>
              </button>
            ))}
            {!scanning && !ipodConnecting && detected.length === 0 && <div className="font-mono text-[8px] text-ink3">NO DEVICE DETECTED</div>}
            <div className="flex gap-1.5">
              <button onClick={() => scanForDevices()} disabled={scanning || ipodConnecting} className="btn btn-secondary text-[11px] py-1.5 flex-1">
                {scanning ? "Scanning…" : "Scan"}
              </button>
              <button onClick={locateDevice} disabled={ipodConnecting} className="btn btn-secondary text-[11px] py-1.5 flex-1">
                Locate
              </button>
            </div>
          </div>
        )}
        {folderError && <p className="text-[10px] text-err leading-relaxed mt-2">{folderError}</p>}
      </div>

      {/* Sources */}
      <div className="px-3 mb-3">
        <div className="font-mono text-[8px] font-semibold tracking-[.18em] text-ink3 px-2 pb-1.5">SOURCES</div>
        <div className="flex flex-col gap-0.5">
          <SourceRow tone="amber" label="Plex" on={plexConnected} state={plexConnected ? "Connected" : (plexConfig?.server_url && plexConfig?.token ? "Configured" : "Off")} onClick={() => navigate("/settings")} />
          <SourceRow tone="emer" label="Spotify" on={!!spot?.connected} state={spot?.connected ? (spot.user_name || "Connected") : (spot?.configured ? "Configured" : "Off")} onClick={() => navigate("/settings")} />
          <SourceRow tone="cyan" label="Soulseek" on={!!slsk?.connected} state={slsk?.connected ? "Connected" : (slsk?.configured ? "Configured" : "Off")} onClick={() => navigate("/settings")} />
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2.5 flex flex-col gap-3.5">
        <NavGroup label="SYNC" items={SYNC} />
        <NavGroup label="MANAGE" items={manage} />
      </div>
    </aside>
  );
}

function StatusCard({ dot, kicker, state, stateColor, title, barPct, barColor, meta, onDisconnect, onRename }: {
  dot: string; kicker: string; state: string; stateColor: string; title: string;
  barPct: number; barColor: string; meta: string; onDisconnect: () => void; onRename?: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const commit = () => { onRename?.(value); setEditing(false); };

  return (
    <div className="panel2 rounded-xl px-3 py-2.5 flex flex-col gap-[7px]">
      <div className="flex items-center gap-[7px]">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: `var(--${dot})` }} />
        <span className="font-mono text-[8px] font-semibold tracking-[.14em] text-ink3 flex-1 min-w-0">{kicker}</span>
        <span className="font-mono text-[8px] tracking-[.1em]" style={{ color: stateColor }}>{state}</span>
        <button onClick={onDisconnect} title="Disconnect" className="text-ink3 hover:text-ink transition-colors">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setValue(title); setEditing(false); }
          }}
          onBlur={commit}
          placeholder="Name this hub"
          className="rounded-lg px-2 py-1 text-[13px] font-semibold text-ink outline-none"
          style={{ background: "var(--panel)", border: "1px solid var(--brandLine)" }}
        />
      ) : (
        <div className="group flex items-center gap-1">
          <div className="text-[13px] font-semibold truncate text-ink flex-1 min-w-0">{title}</div>
          {onRename && (
            <button
              onClick={() => { setValue(title); setEditing(true); }}
              title="Rename hub"
              className="shrink-0 text-ink3 hover:text-ink transition-all opacity-0 group-hover:opacity-100"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487z" />
              </svg>
            </button>
          )}
        </div>
      )}
      <div className="h-[5px] rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
        <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: barColor }} />
      </div>
      <div className="font-mono text-[9px] text-ink2 truncate">{meta}</div>
    </div>
  );
}

function SourceRow({ tone, label, state, on, onClick }: {
  tone: string; label: string; state: string; on: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[10px] hover:bg-panel2 transition-colors text-left">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: on ? `var(--${tone})` : "var(--ink3)", opacity: on ? 1 : 0.4 }} />
      <span className="text-[12px] font-medium flex-1 min-w-0 truncate" style={{ color: on ? "var(--ink)" : "var(--ink3)" }}>{label}</span>
      <span className="font-mono text-[8px] truncate max-w-[86px] shrink-0" style={{ color: on ? `var(--${tone})` : "var(--ink3)" }}>{state}</span>
    </button>
  );
}

function NavGroup({ label, items }: { label: string; items: { to: string; label: string; tone: string; count?: number }[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-mono text-[8px] font-semibold tracking-[.18em] text-ink3 px-2 pb-1.5">{label}</div>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} className="block">
          {({ isActive }) => (
            <div
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[10px] text-[13px] transition-colors ${isActive ? "font-bold text-ink" : "font-medium text-ink2 hover:text-ink"}`}
              style={isActive ? { background: "var(--brandS)", boxShadow: "inset 0 0 0 1px var(--brandLine)" } : undefined}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: isActive ? "var(--brand)" : `var(--${it.tone})`, opacity: isActive ? 1 : 0.55 }} />
              <span className="flex-1 min-w-0 truncate">{it.label}</span>
              {it.count ? (
                <span
                  className="font-mono text-[9px] px-1.5 py-0.5 rounded-full leading-none"
                  style={isActive ? { background: "var(--brand)", color: "var(--brandBtnF)" } : { background: "var(--panel2)", color: "var(--ink3)" }}
                >
                  {it.count.toLocaleString()}
                </span>
              ) : null}
            </div>
          )}
        </NavLink>
      ))}
    </div>
  );
}
