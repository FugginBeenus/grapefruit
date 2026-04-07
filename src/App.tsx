import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import Welcome from "./pages/Welcome";
import Library from "./pages/Library";
import ImportFlow from "./pages/ImportFlow";
import PlaylistDetail from "./pages/PlaylistDetail";
import SyncMusic from "./pages/SyncMusic";
import Duplicates from "./pages/Duplicates";
import PlexSync from "./pages/PlexSync";
import PlexSettings from "./pages/PlexSettings";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Welcome />} />
          <Route path="library" element={<Library />} />
          <Route path="import" element={<ImportFlow />} />
          <Route path="playlist/:name" element={<PlaylistDetail />} />
          <Route path="sync" element={<SyncMusic />} />
          <Route path="duplicates" element={<Duplicates />} />
          <Route path="plex-sync" element={<PlexSync />} />
          <Route path="plex-settings" element={<PlexSettings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
