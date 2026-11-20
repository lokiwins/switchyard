import { isDue } from './alert-time.js';

/**
 * Tiny element builder. Children may be strings, nodes, arrays, or falsy
 * (skipped). Text is always set via text nodes, never parsed as HTML.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function timeAgo(timestamp, now = Date.now()) {
  if (!timestamp) return '—';
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}

/** A "<prefix> 5m ago" label that refreshLiveTimes keeps current without re-rendering. */
export function liveTime(timestamp, prefix = '', attrs = {}) {
  return h('span', {
    title: timestamp ? new Date(timestamp).toLocaleString() : undefined,
    ...attrs,
    'data-since': timestamp ?? '',
    'data-prefix': prefix,
  }, `${prefix}${timeAgo(timestamp)}`);
}

export function refreshLiveTimes(root = document) {
  root.querySelectorAll('[data-since]').forEach((el) => {
    const since = Number(el.dataset.since);
    el.textContent = `${el.dataset.prefix ?? ''}${timeAgo(since || null)}`;
  });
  // Alerts that start at a time (see liveAlert) show once it comes, without drawing the row again.
  root.querySelectorAll('[data-show-at]').forEach((el) => {
    el.hidden = !isDue(el.dataset.showAt);
  });
}

/** An alert that shows from `showAt` (ms) on, kept current by refreshLiveTimes; hidden until then. */
export function liveAlert(showAt, attrs = {}, ...children) {
  return h('span', { ...attrs, 'data-show-at': showAt ?? '', hidden: !isDue(showAt) }, ...children);
}

/** Display a path relative to the home directory when possible. */
export function shortPath(path) {
  return path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~');
}

/** Quote a value for a POSIX shell when it contains anything unusual. */
export function shellQuote(value) {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

let toastTimer = null;

// A toast you can act on (Undo) stays long enough to reach it.
const ACTION_TOAST_MS = 8000;

/** A short message at the bottom of the page; with `action`, a button too ({ label, run }). */
export function toast(message, { action = null } = {}) {
  const el = document.getElementById('toast');
  el.replaceChildren(message, action ? h('button', {
    type: 'button',
    class: 'toast-action',
    onclick: () => {
      el.hidden = true;
      action.run();
    },
  }, action.label) : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  const showMs = action ? ACTION_TOAST_MS : message.length > 60 ? 5000 : 1600;
  toastTimer = setTimeout(() => { el.hidden = true; }, showMs);
}

/** Copies a command; marked with ⧉ so it reads as "copy", not "do". */
export function copyButton(label, text, title) {
  return h('button', {
    type: 'button',
    class: 'btn btn-icon',
    title: `Copy: ${title ?? text}`,
    'aria-label': `Copy ${label} command`,
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast(`Copied: ${text.length > 60 ? `${text.slice(0, 57)}…` : text}`);
      } catch {
        toast('Clipboard unavailable');
      }
    },
  }, h('span', { class: 'copy-icon', 'aria-hidden': 'true' }, '⧉'), label);
}

export function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}
