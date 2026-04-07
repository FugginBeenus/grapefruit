import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useDeviceStore } from "../stores/deviceStore";
import { readPlaylist, deletePlaylist } from "../api/library";
import { plexSyncPlaylists } from "../api/plex";
import { TrackList } from "../components/TrackList";
import { SearchInput } from "../components/SearchInput";
import type { DeviceTrack } from "../types/models";

export default function PlaylistDetail() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { playlists, refreshPlaylists } = useDeviceStore();
  const [tracks, setTracks] = useState<DeviceTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const decoded = name ? decodeURIComponent(name) : "";
  const playlist = playlists.find((p) => p.name === decoded);

  useEffect(() => {
    if (!playlist) return;
    setLoading(true);
    readPlaylist(playlist.path).then(setTracks).catch(() => setTracks([])).finally(() => setLoading(false));
  }, [playlist]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tracks;
    const q = search.toLowerCase();
    return tracks.filter((t) => t.title?.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q) || t.album?.toLowerCase().includes(q));
  }, [tracks, search]);

  const handlePush = async () => {
    setPushing(true);
    setPushMsg(null);
    try {
      const res = await plexSyncPlaylists([decoded]);
      if (res.length > 0) {
        const r = res[0];
        if (r.status === "created" || r.status === "updated") {
          setPushMsg({ text: `${r.status === "created" ? "Created" : "Updated"} on Plex \u2014 ${r.matched} matched, ${r.missing} missing`, ok: true });
        } else if (r.status === "error") {
          setPushMsg({ text: r.error || "Unknown error", ok: false });
        } else {
          setPushMsg({ text: "No matching tracks found on Plex", ok: false });
        }
      }
    } catch (e) {
      setPushMsg({ text: String(e), ok: false });
    } finally {
      setPushing(false);
    }
  };

  const handleDelete = async () => {
    if (!playlist) return;
    await deletePlaylist(playlist.path);
    await refreshPlaylists();
    navigate("/");
  };

  if (!playlist) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-120px)]">
        <p className="text-t-secondary text-sm">Playlist not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] gap-5">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-t">{decoded}</h1>
          <p className="text-[13px] text-t-secondary mt-1">
            {loading ? "Loading..." : `${tracks.length} track${tracks.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-52">
            <SearchInput value={search} onChange={setSearch} placeholder="Filter..." />
          </div>
          <button onClick={handlePush} disabled={pushing || tracks.length === 0} className="btn btn-primary">
            {pushing ? "Pushing..." : "Push to Plex"}
          </button>
          {!confirmDel ? (
            <button onClick={() => setConfirmDel(true)} className="btn btn-ghost text-t-muted">Delete</button>
          ) : (
            <>
              <button onClick={handleDelete} className="btn btn-danger">Confirm Delete</button>
              <button onClick={() => setConfirmDel(false)} className="btn btn-ghost">Cancel</button>
            </>
          )}
        </div>
      </div>

      {/* Status message */}
      {pushMsg && (
        <div className={`p-3 rounded-xl text-[13px] border ${
          pushMsg.ok ? "bg-ok-muted border-ok/20 text-ok" : "bg-err-muted border-err/20 text-err"
        }`}>
          {pushMsg.text}
        </div>
      )}

      {/* Track list */}
      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-t-secondary text-sm">Loading tracks...</div>
        ) : (
          <TrackList tracks={filtered} height={window.innerHeight - 240} />
        )}
      </div>
    </div>
  );
}
