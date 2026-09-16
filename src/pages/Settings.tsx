import { useEffect, useRef, useState } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { open as openDir } from "@tauri-apps/plugin-dialog";
import { usePlexStore } from "../stores/plexStore";
import { useToastStore } from "../stores/toastStore";
import { getAppConfig, setAppConfig } from "../api/appConfig";
import { soulseekStatus, type SoulseekStatus } from "../api/soulseek";
import soulseekLogo from "../assets/soulseek.webp";
import {
  spotifyAuthPoll,
  spotifyAuthStart,
  spotifyDisconnect,
  spotifyGetStatus,
  spotifySetClientId,
} from "../api/spotify";
import type { PlexSection, SpotifyStatus } from "../types/models";

type OrgPattern = "artist-album" | "artist" | "album";

function Field({ label, placeholder, value, onChange, type = "text", hint }: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; type?: string; hint?: string;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-t-secondary mb-1.5">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input" />
      {hint && <p className="mt-1.5 text-[11px] text-t-muted leading-relaxed">{hint}</p>}
    </div>
  );
}

function SpotifyCard() {
  const addToast = useToastStore((s) => s.addToast);
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      const s = await spotifyGetStatus();
      setStatus(s);
      setClientId(s.client_id);
    } catch {
      /* sidecar not ready yet */
    }
  };

  useEffect(() => {
    refresh();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const handleConnect = async () => {
    try {
      const trimmed = clientId.trim();
      if (!trimmed) return;
      await spotifySetClientId(trimmed);
      const { auth_url } = await spotifyAuthStart();
      setConnecting(true);
      await openUrl(auth_url);

      pollTimer.current = setInterval(async () => {
        try {
          const poll = await spotifyAuthPoll();
          if (poll.status === "connected") {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setConnecting(false);
            addToast("success", `Spotify connected${poll.user_name ? ` as ${poll.user_name}` : ""}`);
            refresh();
          } else if (poll.status === "error") {
            if (pollTimer.current) clearInterval(pollTimer.current);
            setConnecting(false);
            addToast("error", `Spotify connection failed: ${poll.error}`);
          }
        } catch {
          /* keep polling */
        }
      }, 1500);
    } catch (e) {
      setConnecting(false);
      addToast("error", String(e));
    }
  };

  const handleDisconnect = async () => {
    await spotifyDisconnect();
    addToast("info", "Spotify disconnected");
    refresh();
  };

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="icon-box icon-box-md icon-box-emerald">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.622.622 0 01-.857.207c-2.348-1.435-5.304-1.76-8.785-.964a.622.622 0 11-.277-1.215c3.809-.871 7.077-.496 9.713 1.115a.623.623 0 01.206.857zm1.223-2.722a.78.78 0 01-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166A.78.78 0 016.32 11.3c3.632-1.102 8.147-.568 11.234 1.328a.78.78 0 01.255 1.074zm.105-2.835c-3.223-1.914-8.54-2.09-11.618-1.156a.935.935 0 11-.543-1.79c3.532-1.072 9.404-.865 13.115 1.338a.936.936 0 01-.954 1.608z" />
            </svg>
          </div>
          <h2 className="text-sm font-bold text-t">Spotify Account</h2>
        </div>
        {status?.connected && (
          <div className="flex items-center gap-1.5 text-[12px] text-ok font-medium">
            <div className="w-2 h-2 rounded-full bg-ok" />
            {status.user_name || "Connected"}
          </div>
        )}
      </div>

      <p className="text-[12px] text-t-muted leading-relaxed mb-3">
        Connect your Spotify account to analyze your full library — Liked Songs and
        every playlist — in the Streaming Gap report.
      </p>

      <div className="flex items-start gap-2 mb-4 p-2.5 rounded-lg border border-line text-[11px] leading-relaxed" style={{ background: "var(--amberS)", color: "var(--amber)" }}>
        <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <span>
          As of Feb 2026, Spotify requires a <strong>Premium</strong> account for API
          access — on a free account, library reads may be blocked. The playlist-URL
          gap still works without any account.
        </span>
      </div>

      {status?.connected ? (
        <button onClick={handleDisconnect} className="btn btn-secondary text-xs">
          Disconnect
        </button>
      ) : (
        <>
          <Field
            label="Client ID"
            placeholder="Your Spotify app Client ID"
            value={clientId}
            onChange={setClientId}
            hint="From your (free) Spotify Developer app — see setup steps below."
          />
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={handleConnect}
              disabled={!clientId.trim() || connecting}
              className="btn btn-primary text-xs"
            >
              {connecting ? "Waiting for Spotify..." : "Connect Spotify"}
            </button>
            {connecting && (
              <span className="text-[11px] text-t-muted">Approve access in your browser</span>
            )}
          </div>
        </>
      )}

      <div className="mt-4">
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="flex items-center gap-1.5 text-[11px] text-t-muted hover:text-t-secondary transition-colors"
        >
          <svg className={`w-3 h-3 transition-transform ${showHelp ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          One-time setup: create your Spotify app (~2 minutes)
        </button>
        {showHelp && (
          <ol className="text-[12px] text-t-secondary space-y-1.5 list-decimal list-inside leading-relaxed mt-3 pl-1">
            <li>
              Go to{" "}
              <button
                onClick={() => openUrl("https://developer.spotify.com/dashboard")}
                className="text-gf hover:text-gf-light transition-colors underline"
              >
                developer.spotify.com/dashboard
              </button>{" "}
              and log in with your Spotify account
            </li>
            <li>Click <strong>Create app</strong> — any name and description</li>
            <li>
              Set the Redirect URI to{" "}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText("http://127.0.0.1:8721/callback");
                  addToast("success", "Redirect URI copied");
                }}
                title="Click to copy"
                className="inline-flex items-center gap-1 bg-bg-surface px-1.5 py-0.5 rounded text-[11px] font-mono text-gf-light hover:bg-bg-hover transition-colors align-baseline"
              >
                http://127.0.0.1:8721/callback
                <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.16-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                </svg>
              </button>
            </li>
            <li>Check <strong>Web API</strong>, save, then copy the <strong>Client ID</strong> here</li>
          </ol>
        )}
      </div>
    </div>
  );
}

function SoulseekCard() {
  const addToast = useToastStore((s) => s.addToast);
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [dir, setDir] = useState("");
  const [searchTimeout, setSearchTimeout] = useState("30");
  const [status, setStatus] = useState<SoulseekStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    getAppConfig().then((c) => {
      setUrl(c.slskd_url || "");
      setApiKey(c.slskd_api_key || "");
      setDir(c.soulseek_download_dir || "");
      setSearchTimeout(String(c.soulseek_search_timeout ?? 30));
    }).catch(() => {});
  }, []);

  const save = async () => {
    await setAppConfig({ slskd_url: url.trim(), slskd_api_key: apiKey.trim(), soulseek_download_dir: dir.trim(), soulseek_search_timeout: Number(searchTimeout) || 30 });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const test = async () => {
    setTesting(true);
    try {
      await setAppConfig({ slskd_url: url.trim(), slskd_api_key: apiKey.trim() });
      const s = await soulseekStatus();
      setStatus(s);
      if (s.connected) addToast("success", `slskd connected${s.version ? ` (v${s.version})` : ""}`);
      else if (s.error) addToast("error", s.error);
      else addToast("info", "slskd reached, but it isn't connected to the Soulseek network yet");
    } catch (e) {
      addToast("error", String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="card p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <img src={soulseekLogo} alt="Soulseek" className="w-8 h-8 rounded-lg object-contain shrink-0" />
          <h2 className="text-sm font-bold text-ink">Soulseek</h2>
        </div>
        {status?.connected && (
          <div className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--emer)" }}>
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--emer)" }} />
            Connected
          </div>
        )}
      </div>

      <p className="text-[12px] text-ink3 leading-relaxed mb-3">
        Fill gaps from Soulseek by pointing Grapefruit at a running <strong>slskd</strong> daemon — it signs in with your Soulseek account and exposes an API. Grapefruit never joins the network itself.
      </p>

      <div className="space-y-3">
        <Field label="slskd URL" placeholder="http://localhost:5030" value={url} onChange={setUrl} hint="Where your slskd instance is reachable." />
        <Field label="API key" placeholder="Your slskd API key" value={apiKey} onChange={setApiKey} type="password" />
        <div>
          <label className="block text-[12px] font-semibold text-t-secondary mb-1.5">Download folder</label>
          <div className="flex gap-2">
            <input type="text" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Where downloads land (defaults to your hub)" className="input flex-1" />
            <button onClick={async () => { const sel = await openDir({ directory: true, multiple: false, title: "Select download folder" }); if (sel) setDir(typeof sel === "string" ? sel : String(sel)); }} className="btn btn-secondary shrink-0">Browse</button>
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-t-secondary mb-1.5">Search wait time</label>
          <div className="flex items-center gap-2">
            <input type="number" min={5} max={120} value={searchTimeout} onChange={(e) => setSearchTimeout(e.target.value)} className="input w-24" />
            <span className="text-[12px] text-ink3">seconds</span>
          </div>
          <p className="text-[11px] text-ink3 mt-1.5">How long to wait for results. Raise it if slow searches come back empty.</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button onClick={test} disabled={testing || !url.trim() || !apiKey.trim()} className="btn btn-secondary text-xs">{testing ? "Testing..." : "Test connection"}</button>
        <button onClick={save} className="btn btn-primary text-xs">Save</button>
        {saved && <span className="text-[12px] font-medium" style={{ color: "var(--emer)" }}>Saved</span>}
        {status && !status.connected && status.error && <span className="text-[11px] text-err">{status.error}</span>}
      </div>

      <div className="mt-4">
        <button onClick={() => setShowHelp(!showHelp)} className="flex items-center gap-1.5 text-[11px] text-ink3 hover:text-ink2 transition-colors">
          <svg className={`w-3 h-3 transition-transform ${showHelp ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          How to set up slskd
        </button>
        {showHelp && (
          <ol className="text-[12px] text-ink2 space-y-1.5 list-decimal list-inside leading-relaxed mt-3 pl-1">
            <li>Install and run <button onClick={() => openUrl("https://github.com/slskd/slskd")} className="text-brand hover:opacity-80 underline">slskd</button> (Docker or a binary) and sign in with your Soulseek account.</li>
            <li>In slskd's config, enable the web API and set an <strong>API key</strong>.</li>
            <li>Put slskd's URL and that API key here, then Test connection.</li>
          </ol>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const {
    config, connected, serverName, testing, error,
    loadConfig, saveConfig, testConnection, fetchSections, sections,
  } = usePlexStore();

  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [musicPath, setMusicPath] = useState("");
  const [saved, setSaved] = useState(false);
  const [showTokenHelp, setShowTokenHelp] = useState(false);
  const [masterLibPath, setMasterLibPath] = useState("");

  const libRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const plexRef = useRef<HTMLDivElement>(null);
  const soulseekRef = useRef<HTMLDivElement>(null);
  const aboutRef = useRef<HTMLDivElement>(null);
  const [activeNav, setActiveNav] = useState("library");
  const go = (key: string) => {
    setActiveNav(key);
    const el = key === "library" ? libRef.current : key === "spotify" ? spotRef.current : key === "plex" ? plexRef.current : key === "soulseek" ? soulseekRef.current : aboutRef.current;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Library settings (localStorage only)
  const [orgPattern, setOrgPattern] = useState<OrgPattern>(
    () => (localStorage.getItem("gf_org_pattern") as OrgPattern) || "artist-album"
  );
  const [autoScan, setAutoScan] = useState(
    () => localStorage.getItem("gf_auto_scan") !== "false"
  );

  useEffect(() => { loadConfig(); }, [loadConfig]);

  useEffect(() => {
    getAppConfig().then((c) => setMasterLibPath(c.master_library_path)).catch(() => {});
  }, []);

  const persistMasterLib = async (p: string) => {
    setMasterLibPath(p);
    try { await setAppConfig({ master_library_path: p }); } catch { /* sidecar not ready */ }
  };

  useEffect(() => {
    if (config) {
      setUrl(config.server_url);
      setToken(config.token);
      setMusicPath(config.music_library_path);
    }
  }, [config]);

  useEffect(() => { localStorage.setItem("gf_org_pattern", orgPattern); }, [orgPattern]);
  useEffect(() => { localStorage.setItem("gf_auto_scan", String(autoScan)); }, [autoScan]);

  const handleTest = async () => {
    const ok = await testConnection(url, token);
    if (ok) await fetchSections();
  };

  const handleSave = async () => {
    await saveConfig({ server_url: url, token, music_library_path: musicPath });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="grid gap-[18px] max-w-[1150px]" style={{ gridTemplateColumns: "180px minmax(0,1fr)" }}>
      {/* Sub-nav */}
      <nav className="flex flex-col gap-0.5 self-start sticky top-0">
        <div className="font-mono text-[9px] tracking-[.16em] text-ink3 px-3 pb-2">SETTINGS</div>
        {[["library", "Library"], ["spotify", "Spotify"], ["plex", "Plex"], ["soulseek", "Soulseek"], ["about", "About"]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => go(key)}
            className="text-left px-3 py-2 rounded-xl text-[13px] transition-colors"
            style={activeNav === key ? { background: "var(--brandS)", color: "var(--brand)", fontWeight: 700 } : { color: "var(--ink2)", fontWeight: 500 }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Panels */}
      <div className="flex flex-col min-w-0">
      {/* Library */}
      <div ref={libRef} className="card p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="icon-box icon-box-md icon-box-amber">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>
          </div>
          <h2 className="text-sm font-bold text-t">Library</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] font-semibold text-t-secondary mb-1.5">Master library path</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={masterLibPath}
                onChange={(e) => setMasterLibPath(e.target.value)}
                onBlur={() => persistMasterLib(masterLibPath)}
                placeholder="/Users/you/Music"
                className="input flex-1"
              />
              <button
                onClick={async () => {
                  const sel = await openDir({ directory: true, multiple: false, title: "Select master library folder", defaultPath: masterLibPath || undefined });
                  if (sel) persistMasterLib(typeof sel === "string" ? sel : String(sel));
                }}
                className="btn btn-secondary shrink-0"
              >
                Browse
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-t-muted">The source-of-truth music folder for Device Sync. Can differ from your Plex server's library path.</p>
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-t-secondary mb-1.5">Auto-organize pattern</label>
            <select
              value={orgPattern}
              onChange={(e) => setOrgPattern(e.target.value as OrgPattern)}
              className="input"
            >
              <option value="artist-album">Artist / Album</option>
              <option value="artist">Artist</option>
              <option value="album">Album</option>
            </select>
            <p className="mt-1.5 text-[11px] text-t-muted">How files are organized when synced to device.</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-semibold text-t-secondary">Scan library on device connect</p>
              <p className="text-[11px] text-t-muted mt-0.5">Automatically scan for tracks when a device is connected.</p>
            </div>
            <button
              onClick={() => setAutoScan(!autoScan)}
              className={`relative w-10 h-5 rounded-full transition-colors ${autoScan ? "bg-emerald" : "bg-bg-surface"}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoScan ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Spotify */}
      <div ref={spotRef}><SpotifyCard /></div>

      {/* Plex Server */}
      <div ref={plexRef} className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#1b1b20", border: "1px solid rgba(229,160,13,0.25)" }}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#E5A00D" aria-label="Plex">
                <path d="M11 3H7l6.5 9L7 21h4l6.5-9z" />
              </svg>
            </div>
            <h2 className="text-sm font-bold text-t">Plex Server</h2>
          </div>
          {connected && (
            <div className="flex items-center gap-1.5 text-[12px] text-ok font-medium">
              <div className="w-2 h-2 rounded-full bg-ok" />
              {serverName}
            </div>
          )}
        </div>

        <div className="space-y-3">
          <Field label="Server URL" placeholder="http://localhost:32400" value={url} onChange={setUrl} />
          <Field label="Access Token" placeholder="Your Plex token" value={token} onChange={setToken} type="password" />
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button onClick={handleTest} disabled={testing || !url || !token} className="btn btn-secondary text-xs">
            {testing ? "Testing..." : "Test Connection"}
          </button>
          {connected && <span className="text-[11px] text-ok font-medium">Connected</span>}
        </div>

        <div className="mt-4">
          <Field
            label="Music Library Path"
            placeholder="/path/to/your/music"
            value={musicPath}
            onChange={setMusicPath}
            hint="Local path to the music folder Plex indexes. Used for high-accuracy filename matching."
          />
        </div>

        {sections.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] text-t-muted font-medium mb-2">Detected sections</p>
            <div className="flex flex-wrap gap-2">
              {sections.map((s: PlexSection) => (
                <span key={s.key} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-bg-primary text-[12px] text-t-secondary border">
                  <div className="w-1.5 h-1.5 rounded-full bg-gf" />
                  {s.title}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Save button */}
        <div className="flex items-center gap-3 mt-5 pt-4 border-t">
          <button onClick={handleSave} className="btn btn-primary text-xs">Save Settings</button>
          {saved && <span className="text-[12px] text-ok font-medium">Saved!</span>}
        </div>

        {/* Token help */}
        <div className="mt-4">
          <button
            onClick={() => setShowTokenHelp(!showTokenHelp)}
            className="flex items-center gap-1.5 text-[11px] text-t-muted hover:text-t-secondary transition-colors"
          >
            <svg className={`w-3 h-3 transition-transform ${showTokenHelp ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            How to find your Plex token
          </button>
          {showTokenHelp && (
            <ol className="text-[12px] text-t-secondary space-y-1.5 list-decimal list-inside leading-relaxed mt-3 pl-1">
              <li>Open Plex Web App and sign in</li>
              <li>Browse to any media item, click the three-dot menu</li>
              <li>Click <strong>Get Info</strong> then <strong>View XML</strong></li>
              <li>
                In the URL, copy the value after{" "}
                <code className="bg-bg-surface px-1.5 py-0.5 rounded text-[11px] font-mono text-gf-light">X-Plex-Token=</code>
              </li>
            </ol>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err mb-4">{error}</div>
      )}

      {/* Soulseek */}
      <div ref={soulseekRef}><SoulseekCard /></div>

      {/* About */}
      <div ref={aboutRef} className="card p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="icon-box icon-box-md icon-box-gf">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
          </div>
          <h2 className="text-sm font-bold text-t">About</h2>
        </div>
        <p className="text-[13px] text-t-secondary font-medium">Grapefruit v2.3.0</p>
        <p className="text-[12px] text-t-muted mt-1">
          Music sync manager — keep streaming, Plex, and your devices in step with the library you own
        </p>
        <a
          href="https://github.com/FugginBeenus/grapefruit"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-3 text-[12px] text-gf hover:text-gf-light transition-colors"
        >
          github.com/FugginBeenus/grapefruit
        </a>
      </div>
      </div>
    </div>
  );
}
