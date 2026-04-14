import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import Library from "./pages/Library";
import Playlists from "./pages/Playlists";
import ImportFlow from "./pages/ImportFlow";
import Sync from "./pages/Sync";
import Settings from "./pages/Settings";
import Tools from "./pages/Tools";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/library" replace />} />
          <Route path="library" element={<Library />} />
          <Route path="playlists" element={<Playlists />} />
          <Route path="playlists/:name" element={<Playlists />} />
          <Route path="import" element={<ImportFlow />} />
          <Route path="tools" element={<Tools />} />
          <Route path="sync" element={<Sync />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
