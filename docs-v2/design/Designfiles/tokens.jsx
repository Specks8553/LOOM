
// ─── LOOM Design Tokens (Approved) ───
// Warm palette · Sage accent · Plus Jakarta Sans stack

const T = {
  // Backgrounds
  bgBase:     "#100f0c",
  bgPane:     "#15140f",
  bgTheater:  "#0c0b08",
  bgElevated: "#1d1b16",
  bgHover:    "#262318",
  bgActive:   "#2e2b21",

  // Borders
  border:     "#2d291f",
  borderSub:  "#221f17",

  // Text
  txtPri:     "#e7e4dc",
  txtSec:     "#8c867a",
  txtMut:     "#595349",
  txtInverse: "#100f0c",
  txtOnAccent:"#ffffff",

  // Accent (Sage default)
  accent:     "#6b9f78",
  accentHov:  "#5a8a67",
  accentSub:  "#161f18",
  accentText: "#a8d4b3",
  accentRgba: (a) => `rgba(107,159,120,${a})`,

  // Semantic
  success:    "#10b981",
  warning:    "#f59e0b",
  error:      "#f43f5e",

  // Feature (track accent by default)
  ghostwriter:    "#6b9f78",
  ghostwriterSub: "#161f18",
  accordion:      "#6b9f78",
  checkpoint:     "#6b9f78",
  feedback:       "#f59e0b",
  feedbackSub:    "rgba(245,158,11,0.06)",

  // Radii
  radiusBubble: 10,
  radiusCard:   6,
  radiusInput:  4,
  radiusSm:     3,

  // Typography
  sans:  "'Plus Jakarta Sans', system-ui, sans-serif",
  serif: "'Source Serif 4', Georgia, serif",
  mono:  "'Source Code Pro', 'Consolas', monospace",

  // Accent presets (all six options)
  presets: {
    violet:   "#7c3aed",
    lavender: "#8b6cc1",
    teal:     "#2aa198",
    ember:    "#c87941",
    sage:     "#6b9f78",
    rose:     "#c2667a",
  },
};

Object.assign(window, { T });
