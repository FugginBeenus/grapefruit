import { useState } from "react";
import type { TrackMetadata, AlbumArt } from "../types/models";

interface MetadataEditorProps {
  metadata: TrackMetadata;
  albumArt: AlbumArt | null;
  onSave: (meta: Partial<TrackMetadata>) => Promise<void>;
  onClose: () => void;
  onArtChange: (base64Data: string | null) => Promise<void>;
}

export default function MetadataEditor({ metadata, albumArt, onSave, onClose, onArtChange }: MetadataEditorProps) {
  const [title, setTitle] = useState(metadata.title);
  const [artist, setArtist] = useState(metadata.artist);
  const [album, setAlbum] = useState(metadata.album);
  const [albumartist, setAlbumArtist] = useState(metadata.albumartist);
  const [trackNum, setTrackNum] = useState(metadata.track_number?.toString() ?? "");
  const [discNum, setDiscNum] = useState(metadata.disc_number?.toString() ?? "");
  const [year, setYear] = useState(metadata.year?.toString() ?? "");
  const [genre, setGenre] = useState(metadata.genre);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave({
      title, artist, album, albumartist,
      track_number: trackNum ? parseInt(trackNum, 10) : null,
      disc_number: discNum ? parseInt(discNum, 10) : null,
      year: year ? parseInt(year, 10) : null,
      genre,
    });
    setSaving(false);
  };

  const handleArtUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        await onArtChange(base64);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop" onClick={onClose}>
      <div className="bg-bg-primary rounded-2xl border w-[520px] max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-sm font-bold text-t">Edit Track Info</h2>
          <button onClick={onClose} className="text-t-muted hover:text-t text-lg leading-none">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Album Art */}
          <div className="flex items-start gap-4">
            <div className="w-24 h-24 rounded-lg bg-bg-surface border flex items-center justify-center overflow-hidden shrink-0">
              {albumArt?.has_artwork && albumArt.data ? (
                <img src={`data:${albumArt.mime || "image/jpeg"};base64,${albumArt.data}`} className="w-full h-full object-cover" />
              ) : (
                <svg className="w-8 h-8 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                </svg>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={handleArtUpload} className="btn btn-ghost text-[12px] py-1 px-3">
                {albumArt?.has_artwork ? "Replace Art" : "Add Art"}
              </button>
              {albumArt?.has_artwork && (
                <button onClick={() => onArtChange(null)} className="btn btn-ghost text-err text-[12px] py-1 px-3">Remove Art</button>
              )}
            </div>
          </div>

          {/* Fields */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Title" value={title} onChange={setTitle} span={2} />
            <Field label="Artist" value={artist} onChange={setArtist} />
            <Field label="Album Artist" value={albumartist} onChange={setAlbumArtist} />
            <Field label="Album" value={album} onChange={setAlbum} span={2} />
            <Field label="Genre" value={genre} onChange={setGenre} />
            <Field label="Year" value={year} onChange={setYear} type="number" />
            <Field label="Track #" value={trackNum} onChange={setTrackNum} type="number" />
            <Field label="Disc #" value={discNum} onChange={setDiscNum} type="number" />
          </div>

          {/* Path */}
          <div>
            <p className="text-[10px] text-t-muted uppercase font-semibold mb-1">File</p>
            <p className="text-[11px] text-t-secondary break-all">{metadata.path}</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-b">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary">
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", span }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; span?: number;
}) {
  return (
    <div className={span === 2 ? "col-span-2" : ""}>
      <label className="block text-[11px] text-t-muted uppercase font-semibold mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="input w-full text-[13px]"
      />
    </div>
  );
}
