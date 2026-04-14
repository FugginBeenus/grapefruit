import { useEffect, useState } from "react";
import { usePlexStore } from "../stores/plexStore";
import type { PlexSection } from "../types/models";

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

  // Library settings (localStorage only)
  const [orgPattern, setOrgPattern] = useState<OrgPattern>(
    () => (localStorage.getItem("gf_org_pattern") as OrgPattern) || "artist-album"
  );
  const [autoScan, setAutoScan] = useState(
    () => localStorage.getItem("gf_auto_scan") !== "false"
  );

  useEffect(() => { loadConfig(); }, [loadConfig]);

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
    <div className="max-w-xl">
      <div className="mb-6 pt-2">
        <h1 className="text-3xl font-bold text-t tracking-tight">Settings</h1>
        <p className="text-sm text-t-muted mt-1">Manage your app preferences and server connections</p>
      </div>

      {/* Library */}
      <div className="card p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="icon-box icon-box-md icon-box-amber">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>
          </div>
          <h2 className="text-sm font-bold text-t">Library</h2>
        </div>
        <div className="space-y-4">
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

      {/* Plex Server */}
      <div className="card p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="icon-box icon-box-md icon-box-violet">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" /></svg>
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

      {/* About */}
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="icon-box icon-box-md icon-box-gf">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
          </div>
          <h2 className="text-sm font-bold text-t">About</h2>
        </div>
        <p className="text-[13px] text-t-secondary font-medium">Grapefruit v2.0.0</p>
        <p className="text-[12px] text-t-muted mt-1">Music manager for iPod, Rockbox & Plex</p>
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
  );
}
