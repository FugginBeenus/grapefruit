/** Grapefruit color palette — mirrors the Python theme.py */
export const colors = {
  // Status
  matched: "#2ecc71",
  matchedBg: "#1e3a2a",
  uncertain: "#f39c12",
  uncertainBg: "#3a3020",
  missing: "#e74c3c",
  missingBg: "#3a1e1e",
  confirmed: "#27ae60",
  confirmedBg: "#1e3a2a",
  manual: "#3498db",
  manualBg: "#1e2a3a",
  rejected: "#95a5a6",
  rejectedBg: "#2e2e2e",

  // UI
  accent: "#FF6F61",
  accentHover: "#E85D50",
  surface: "#323232",
  surfaceHover: "#3e3e3e",
  textPrimary: "#f0f0f0",
  textSecondary: "#c0c0c0",
  textMuted: "#8a8a8a",
  border: "#4a4a4a",

  // Steps
  stepActive: "#FF6F61",
  stepDone: "#2ecc71",
  stepPending: "#606060",

  // Tree/table
  treeBg: "#252525",
  treeRowAlt: "#2c2c2c",

  // Sidebar
  sidebarBg: "#1a1a1a",
  sidebarItemHover: "#2a2a2a",
  sidebarActive: "#FF6F61",
  sidebarSection: "#666666",

  // Background
  bg: "#1e1e1e",
} as const;
