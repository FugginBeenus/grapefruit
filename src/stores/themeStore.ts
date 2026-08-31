import { create } from "zustand";

export type Theme = "dark" | "light";

const KEY = "grapefruit:theme";

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  const el = document.documentElement;
  el.classList.remove("gf-dark", "gf-light");
  el.classList.add(theme === "light" ? "gf-light" : "gf-dark");
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getStoredTheme(),
  setTheme: (theme) => {
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
    applyTheme(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === "light" ? "dark" : "light"),
}));
