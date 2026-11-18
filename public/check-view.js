import { h, liveTime } from './dom.js';
import { checkLabel } from './check-status.js';

/*
 * A worktree's check (see src/checks.js) on the Tasks page and the attempt
 * cards: its result, with the end of its output to open, and Run check.
 */

// Lines of output shown when a check's result is opened.
const OUTPUT_LINES = 40;

function runButton(label, onRun) {
  const button = h('button', {
    type: 'button',
    class: 'btn btn-sm btn-secondary',
    title: 'Run its repo\'s check command (Settings › Checks) in this worktree',
    onclick: async () => {
      button.disabled = true;
      try {
        await onRun();
      } finally {
        button.disabled = false;
      }
    },
  }, label);
  return button;
}

/**
 * The check for a worktree: its latest result, opened to show its output and
 * Run again; Run check when there's none yet. `canRun` is whether its repo
 * has a check command; `onRun()` starts one. Null when there's nothing to show.
 */
export function checkControl(check, { canRun, onRun }) {
  if (!check) return canRun ? runButton('Run check', onRun) : null;
  const { text, tone } = checkLabel(check);
  const output = String(check.output ?? '').trimEnd().split('\n').slice(-OUTPUT_LINES).join('\n');
  return h('details', { class: `check-status ${tone}` },
    h('summary', { title: check.command ? `Ran: ${check.command}` : undefined }, text),
    h('div', { class: 'check-body' },
      h('p', { class: 'check-meta' },
        h('code', {}, check.command ?? ''),
        check.finishedAt ? [' · ', liveTime(check.finishedAt, 'finished ')] : check.startedAt ? [' · ', liveTime(check.startedAt, 'started ')] : null),
      check.detail && h('p', { class: 'check-meta' }, check.detail),
      output && h('pre', { class: 'check-output' }, output),
      canRun && check.state !== 'running' && runButton('Run again', onRun)));
}
