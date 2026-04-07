import { useEffect, useState } from "react";
import { usePlexStore } from "../stores/plexStore";

export default function PlexSettings() {
  const { config, connected, serverName, testing, loading, error, loadConfig, saveConfig, testConnection, fetchSections, sections } = usePlexStore();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [musicPath, setMusicPath] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => {
    if (config) { setUrl(config.server_url); setToken(config.token); setMusicPath(config.music_library_path); }
  }, [config]);

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
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-t">Plex Settings</h1>
        <p className="text-[13px] text-t-secondary mt-1">Configure your Plex server connection</p>
      </div>

      {/* Connection */}
      <div className="card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-t">Server Connection</h2>
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

        <button onClick={handleTest} disabled={testing || !url || !token} className="btn btn-primary">
          {testing ? "Testing..." : "Test Connection"}
        </button>
      </div>

      {/* Library */}
      <div className="card p-6 space-y-5">
        <h2 className="text-sm font-bold text-t">Music Library</h2>
        <Field
          label="Music Library Path"
          placeholder="/path/to/your/music"
          value={musicPath}
          onChange={setMusicPath}
          hint="Local path to the music folder Plex indexes. Used for high-accuracy filename matching."
        />
        {sections.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] text-t-muted font-medium">Detected sections:</p>
            {sections.map((s) => (
              <div key={s.key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-primary text-[12px] text-t-secondary">
                <div className="w-1.5 h-1.5 rounded-full bg-gf" />
                {s.title}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="btn btn-primary">Save Settings</button>
        {saved && <span className="text-[13px] text-ok font-medium">Saved!</span>}
      </div>

      {error && <div className="p-4 rounded-xl bg-err-muted border border-err/20 text-[13px] text-err">{error}</div>}

      {/* Help */}
      <div className="card p-5 space-y-3">
        <p className="text-[12px] font-bold text-t-secondary">How to find your Plex token</p>
        <ol className="text-[12px] text-t-secondary space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>Open Plex Web App and sign in</li>
          <li>Browse to any media item, click the three-dot menu</li>
          <li>Click <strong className="text-t-secondary">Get Info</strong> then <strong className="text-t-secondary">View XML</strong></li>
          <li>In the URL, copy the value after <code className="bg-bg-surface px-1.5 py-0.5 rounded text-[11px] font-mono text-gf-light">X-Plex-Token=</code></li>
        </ol>
      </div>
    </div>
  );
}

function Field({ label, placeholder, value, onChange, type = "text", hint }: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void; type?: string; hint?: string;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-t-secondary mb-1.5">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input" />
      {hint && <p className="mt-1.5 text-[11px] text-t-muted leading-relaxed">{hint}</p>}
    </div>
  );
}
