/*
 * Keys the live terminal sends differently from xterm.js. A browser terminal
 * sends Shift+Enter as a plain Enter, which submits Claude's prompt; Claude
 * Code takes Option+Enter (ESC, then Return) as a new line instead, as does
 * a shell's line editor, where it does nothing harmful.
 */

export const NEW_LINE = '\x1b\r';

/**
 * For xterm.js's key event handler: `{ send }` for a key handled here (send
 * is null for the keypress and keyup that follow it, which are swallowed),
 * or null to let the terminal handle the key itself.
 */
export function keyInput(event) {
  const shiftEnter = event.key === 'Enter' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
  if (!shiftEnter || event.isComposing) return null;
  return { send: event.type === 'keydown' ? NEW_LINE : null };
}
