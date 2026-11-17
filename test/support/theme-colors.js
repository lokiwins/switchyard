import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * The page themes' colour tokens, read from styles.css (Classic) and
 * themes.css (the rest) and resolved to sRGB, for contrast checks. Handles
 * the forms the themes use: #hex, oklch(L C H [/ a]) and
 * color-mix(in oklab, <colour> N%, transparent).
 */

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public');
const read = (file) => readFileSync(join(PUBLIC_DIR, file), 'utf8');

/** The custom properties a rule for `selector` sets, as written. */
function block(css, selector) {
  const escaped = selector.replace(/[[\]"=().]/g, (c) => `\\${c}`);
  const rule = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!rule) return {};
  return Object.fromEntries([...rule[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** Every token, as written, for a theme and scheme (Classic's from styles.css, the rest layered over it). */
export function themeTokens(theme, scheme) {
  const styles = read('styles.css');
  const themes = read('themes.css');
  const root = block(styles, ':root');
  const classicDark = scheme === 'dark' ? block(styles, ':root[data-scheme="dark"]') : {};
  if (theme === 'classic') return { ...root, ...classicDark };
  return { ...root, ...block(themes, `:root[data-theme="${theme}"]`), ...(scheme === 'dark' ? block(themes, `:root[data-theme="${theme}"][data-scheme="dark"]`) : {}) };
}

const clamp = (x) => Math.min(1, Math.max(0, x));
const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => clamp(gamma(c)));
}

/** A colour as { rgb: [r,g,b] in 0..1, alpha }, or null for one this doesn't read. */
export function parseColor(value, tokens = {}) {
  const v = value.trim();
  const ref = v.match(/^var\(--([a-z0-9-]+)\)$/);
  if (ref) return tokens[ref[1]] ? parseColor(tokens[ref[1]], tokens) : null;
  const short = v.match(/^#([0-9a-f]{3})$/i);
  if (short) return parseColor(`#${[...short[1]].map((c) => c + c).join('')}`);
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255), alpha: 1 };
  const ok = v.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\)$/);
  if (ok) return { rgb: oklchToRgb(Number(ok[1]) / 100, Number(ok[2]), Number(ok[3])), alpha: ok[4] ? Number(ok[4]) : 1 };
  const mix = v.match(/^color-mix\(in oklab,\s*(.+)\s+([\d.]+)%,\s*transparent\)$/);
  if (mix) {
    const inner = parseColor(mix[1], tokens);
    return inner && { rgb: inner.rgb, alpha: inner.alpha * (Number(mix[2]) / 100) };
  }
  return null;
}

/** `top` over the opaque `under`. */
export const over = (top, under) => ({ rgb: top.rgb.map((c, i) => c * top.alpha + under.rgb[i] * (1 - top.alpha)), alpha: 1 });

function luminance([r, g, b]) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast of text `fg` on `bg` (each a token name), with translucent colours laid over the surface first. */
export function contrastOf(tokens, fg, bg) {
  const color = (name) => {
    const parsed = tokens[name] && parseColor(tokens[name], tokens);
    if (!parsed) throw new Error(`Can't read --${name}: ${tokens[name]}`);
    return parsed;
  };
  const back = over(color(bg), color('surface'));
  const text = over(color(fg), back);
  const [hi, lo] = [luminance(text.rgb), luminance(back.rgb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
