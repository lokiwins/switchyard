/*
 * The live terminal's colours: its 16 ANSI colours, text, cursor and
 * selection, and the glass pane around it (which the review and task panes
 * share). "Match page theme" uses the palette made for the page's theme in
 * its light or dark; the named schemes are the same everywhere. Their colours
 * are the schemes' own published palettes.
 *
 * Plain data and functions, no DOM, so the server and tests can use it too.
 */

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];

/** A palette from its background, text, cursor, selection, and 16 ANSI colours in order. */
function palette({ light = false, background, foreground, cursor, selection, accent = cursor, pane = null }, colors) {
  return Object.freeze({
    light, background, foreground, cursor, selection, accent, pane,
    ...Object.fromEntries(ANSI.map((name, i) => [name, colors[i]])),
  });
}

// xterm.js's own defaults: Classic dark keeps exactly the colours the terminal had before themes.
const XTERM_DEFAULT_ANSI = ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
  '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'];

export const TERMINAL_PALETTES = Object.freeze({
  // The page themes, light and dark.
  'classic-dark': palette({
    background: '#080d18', foreground: '#ffffff', cursor: '#7dd3fc', selection: '#7dd3fc',
    // The glass as it has always been.
    pane: {
      '--pane-bg': 'rgb(8 13 24 / 0.68)', '--pane-tint-a': 'rgb(56 189 248 / 0.10)', '--pane-tint-b': 'rgb(168 85 247 / 0.08)',
      '--pane-edge': 'rgb(125 211 252 / 0.28)', '--pane-glow': 'rgb(56 189 248 / 0.18)', '--pane-text': '#e6f1ff', '--pane-dim': '#8aa4c2',
      '--pane-accent': '#7dd3fc', '--pane-accent-strong': '#38bdf8', '--pane-ok': '#34d399', '--pane-wait': '#fbbf24', '--pane-bad': '#f87171',
      '--pane-add-text': '#a7f3d0', '--pane-del-text': '#fecaca',
    },
  }, XTERM_DEFAULT_ANSI),
  'classic-light': palette({ light: true, background: '#f7f9fb', foreground: '#102a43', cursor: '#3b6fd8', selection: '#3b6fd8' },
    ['#24292f', '#cf222e', '#116329', '#7d4e00', '#0969da', '#8250df', '#1b7c83', '#6e7781',
      '#57606a', '#a40e26', '#1a7f37', '#633c01', '#218bff', '#a475f9', '#3192aa', '#8c959f']),
  'signal-dark': palette({ background: '#0a0d10', foreground: '#e8edf0', cursor: '#4fd1e0', selection: '#4fd1e0' },
    ['#1a1f24', '#ff6b6b', '#5ee3a1', '#f2d675', '#6cb6ff', '#c79bff', '#4fd1e0', '#c9d1d9',
      '#4b5560', '#ff8f8f', '#86efbd', '#f8e49c', '#95cbff', '#dbbcff', '#86e5ef', '#ffffff']),
  'signal-light': palette({ light: true, background: '#f6f8f9', foreground: '#1b2229', cursor: '#0e7d93', selection: '#0e7d93' },
    ['#1b2229', '#c62f3a', '#1d7f4f', '#8a5a00', '#1565c0', '#7b45c9', '#0e7d93', '#6b7680',
      '#4a545e', '#a3202b', '#16663f', '#6e4700', '#0d4f9e', '#6230a8', '#0b6577', '#8b959e']),
  'ember-dark': palette({ background: '#1f1a17', foreground: '#f0e6d8', cursor: '#e8955a', selection: '#e8955a' },
    ['#2b2420', '#e5675f', '#9bc27a', '#e9c46a', '#7aa6c2', '#c98bb9', '#7cbfb0', '#d9cbb8',
      '#5c5048', '#f08c84', '#b5d699', '#f2d690', '#9cc0d6', '#dcaacd', '#9fd4c7', '#fbf3e8']),
  'ember-light': palette({ light: true, background: '#fbf7f0', foreground: '#3a2c22', cursor: '#b5562a', selection: '#b5562a' },
    ['#3a2c22', '#b63a30', '#4f7a2a', '#8a6100', '#2f6488', '#8d4a7c', '#2f7a6e', '#8a7b6c',
      '#6b5a4c', '#962c24', '#3d6120', '#6f4e00', '#245170', '#723a64', '#235f56', '#a8998a']),
  'dusk-dark': palette({ background: '#17142a', foreground: '#e6e3f5', cursor: '#a99bff', selection: '#a99bff' },
    ['#24203f', '#ff7a9a', '#7ee0b0', '#f0cf7a', '#8aa8ff', '#c79bff', '#79d8e6', '#cfcbe6',
      '#575174', '#ff9db4', '#a1ebc7', '#f6dd9e', '#adc1ff', '#dbbcff', '#9ee4ee', '#ffffff']),
  'dusk-light': palette({ light: true, background: '#f8f7fd', foreground: '#24203f', cursor: '#5b45d6', selection: '#5b45d6' },
    ['#24203f', '#c42a55', '#1f7a55', '#8a6300', '#3d5ccc', '#7a3fd1', '#1f7287', '#6d6a86',
      '#4f4b6b', '#a01f45', '#176044', '#6e4f00', '#2f48a8', '#6230b0', '#175a6b', '#8e8ba6']),
  'graphite-dark': palette({ background: '#121212', foreground: '#f2f2f2', cursor: '#ffffff', selection: '#ffffff', accent: '#d4d4d4' },
    ['#1c1c1c', '#ff6b6b', '#6bd68f', '#f2d067', '#79a7ff', '#c792ea', '#6fd3d6', '#d4d4d4',
      '#555555', '#ff8f8f', '#8fe4aa', '#f7df91', '#a0c1ff', '#d9b2f1', '#94e1e3', '#ffffff']),
  'graphite-light': palette({ light: true, background: '#ffffff', foreground: '#111111', cursor: '#111111', selection: '#111111', accent: '#333333' },
    ['#111111', '#c22525', '#1a7a3c', '#7a5b00', '#1f5fd1', '#8a3fc4', '#127a80', '#666666',
      '#444444', '#9e1b1b', '#13602f', '#5e4600', '#174aa6', '#6e2f9e', '#0e5f63', '#8a8a8a']),

  'coast-dark': palette({ background: '#1e1029', foreground: '#f6e9f1', cursor: '#ff5fa8', selection: '#ff5fa8' },
    ['#2a1838', '#ff6b7f', '#3fe0c5', '#ffc46b', '#6aa8ff', '#ff5fa8', '#56d6f0', '#d9c6d6',
      '#6a4e72', '#ff8e9c', '#7aeed8', '#ffd696', '#93c0ff', '#ff8cc3', '#86e4f5', '#ffffff']),
  'coast-light': palette({ light: true, background: '#fff6ef', foreground: '#3a1a3e', cursor: '#c2185b', selection: '#c2185b' },
    ['#3a1a3e', '#c62839', '#0f7a6c', '#9a5b00', '#2958c6', '#b5177a', '#0f7a91', '#7d6478',
      '#5b3f5c', '#a01c2c', '#0b6156', '#7a4800', '#1f45a0', '#921262', '#0b6273', '#a08a9c']),

  'heatwave-dark': palette({ background: '#1a0631', foreground: '#fff4e6', cursor: '#FF9B55', selection: '#C9349B', accent: '#F36A78' },
    ['#2a0e4c', '#F87572', '#4fe3c8', '#FFB458', '#9a8cff', '#C9349B', '#5fd4f0', '#e8cfe4',
      '#6b3d8f', '#ff9a96', '#86eed9', '#ffcb85', '#bbb0ff', '#e66bc0', '#8ae3f5', '#ffffff']),
  'heatwave-light': palette({ light: true, background: '#fff1df', foreground: '#2a0d4e', cursor: '#C9349B', selection: '#C9349B', accent: '#a8287f' },
    ['#2a0d4e', '#c42a3d', '#0f7468', '#9a4a00', '#3b4fc4', '#a8287f', '#0f6f8a', '#7a5a8a',
      '#4f2475', '#9e1f30', '#0b5a50', '#7a3a00', '#2d3d9e', '#861f66', '#0b576d', '#9a7aa8']),

  // Named schemes.
  dracula: palette({ background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selection: '#6272a4', accent: '#bd93f9' },
    ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']),
  'solarized-dark': palette({ background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', selection: '#586e75', accent: '#268bd2' },
    ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']),
  'solarized-light': palette({ light: true, background: '#fdf6e3', foreground: '#586e75', cursor: '#586e75', selection: '#93a1a1', accent: '#268bd2' },
    ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
      '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']),
  nord: palette({ background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selection: '#4c566a', accent: '#88c0d0' },
    ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']),
  'gruvbox-dark': palette({ background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selection: '#665c54', accent: '#fabd2f' },
    ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
      '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2']),
  'tokyo-night': palette({ background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', selection: '#33467c', accent: '#7aa2f7' },
    ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
      '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5']),
  'catppuccin-mocha': palette({ background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selection: '#585b70', accent: '#cba6f7' },
    ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
      '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8']),
  'catppuccin-latte': palette({ light: true, background: '#eff1f5', foreground: '#4c4f69', cursor: '#dc8a78', selection: '#acb0be', accent: '#8839ef' },
    ['#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be',
      '#6c6f85', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#bcc0cc']),
  'one-dark': palette({ background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selection: '#3e4451', accent: '#61afef' },
    ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
      '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff']),
});

export const TERMINAL_CHOICES = Object.freeze([
  { id: 'match', label: 'Match page theme' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'solarized-dark', label: 'Solarized Dark' },
  { id: 'solarized-light', label: 'Solarized Light' },
  { id: 'nord', label: 'Nord' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte' },
  { id: 'one-dark', label: 'One Dark' },
].map(Object.freeze));

export const TERMINAL_IDS = TERMINAL_CHOICES.map((choice) => choice.id);

/**
 * The terminal pane's own picker, from theme-boot.js's current(): the Settings
 * default (named), then every choice, with this browser's choice selected
 * ('' when it uses the default).
 */
export function terminalPicker({ own, defaults }) {
  const label = (id) => TERMINAL_CHOICES.find((choice) => choice.id === id)?.label ?? id;
  return {
    selected: own.terminal ?? '',
    options: [
      { value: '', label: `Settings default (${label(defaults.terminal)})` },
      ...TERMINAL_CHOICES.map((choice) => ({ value: choice.id, label: choice.label })),
    ],
  };
}

/** The palette for a terminal choice, on a page in `theme` and `scheme` (light or dark). */
export function terminalPalette(choice, theme, scheme) {
  if (choice !== 'match' && TERMINAL_PALETTES[choice]) return TERMINAL_PALETTES[choice];
  return TERMINAL_PALETTES[`${theme}-${scheme}`] ?? TERMINAL_PALETTES[`classic-${scheme}`] ?? TERMINAL_PALETTES['classic-dark'];
}

/** `#rrggbb` at `alpha`, as rgb(r g b / a). */
function withAlpha(hex, alpha) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

// Claude Code picks its own colours for the dark or light it's set to, some as exact RGB a palette can't
// change; on a light terminal, xterm darkens any text too faint to read against the background.
const LIGHT_MIN_CONTRAST = 4.5;

/**
 * The theme xterm.js draws with. Cells stay transparent so the glass pane
 * shows through, but carry the background's colour so xterm can judge contrast.
 */
export function xtermTheme(p) {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r, g, b] = rgb(p.selection);
  return {
    background: `rgba(${rgb(p.background).join(', ')}, 0)`,
    foreground: p.foreground,
    cursor: p.cursor,
    cursorAccent: p.background,
    selectionBackground: `rgba(${r}, ${g}, ${b}, ${p.light ? 0.25 : 0.3})`,
    ...Object.fromEntries(ANSI.map((name) => [name, p[name]])),
  };
}

/** xterm.js options for a palette: its theme, and for a light one, a floor on text contrast. */
export function xtermOptions(p) {
  return { theme: xtermTheme(p), minimumContrastRatio: p.light ? LIGHT_MIN_CONTRAST : 1 };
}

/**
 * The glass pane's tokens (see Dialog.tsx and themes.css). Only the pane: the
 * dimming of the page behind it (--pane-backdrop) stays the same whatever the
 * terminal, so a terminal theme never changes how the page itself looks.
 */
export const PANE_TOKENS = Object.freeze([
  '--pane-bg', '--pane-tint-a', '--pane-tint-b', '--pane-edge', '--pane-glow', '--pane-text', '--pane-dim',
  '--pane-accent', '--pane-accent-strong', '--pane-ok', '--pane-wait', '--pane-bad', '--pane-add-text', '--pane-del-text',
  '--pane-shade', '--pane-shine', '--pane-lift', '--pane-drop', '--pane-scheme',
]);

/** The glass pane's tokens for a palette: tinted by its background and accent, light glass for a light scheme. */
export function paneVars(p) {
  const light = p.light;
  const derived = {
    '--pane-bg': withAlpha(p.background, light ? 0.86 : 0.8),
    '--pane-tint-a': withAlpha(p.accent, 0.1),
    '--pane-tint-b': withAlpha(p.magenta, 0.08),
    '--pane-edge': withAlpha(p.accent, light ? 0.35 : 0.28),
    '--pane-glow': withAlpha(p.accent, 0.18),
    '--pane-text': p.foreground,
    '--pane-dim': light ? p.brightBlack : p.white,
    '--pane-accent': light ? p.blue : p.accent,
    '--pane-accent-strong': p.blue,
    '--pane-ok': p.green,
    '--pane-wait': p.yellow,
    '--pane-bad': p.red,
    '--pane-add-text': light ? p.green : p.brightGreen,
    '--pane-del-text': light ? p.red : p.brightRed,
  };
  return {
    ...derived,
    ...(p.pane ?? {}),
    // How wells (inputs, code) darken, buttons lighten, and status text lifts off the glass.
    '--pane-shade': light ? '#64748b' : '#000000',
    '--pane-shine': '#ffffff',
    '--pane-lift': light ? '#000000' : '#ffffff',
    '--pane-drop': light ? 'rgb(15 23 42 / 0.25)' : 'rgb(0 0 0 / 0.55)',
    '--pane-scheme': light ? 'light' : 'dark',
  };
}
