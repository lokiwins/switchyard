import { h, liveTime } from './dom.js';
import { anyRunning, checkLabel, ranBy } from './check-status.js';

/*
 * A worktree's checks (see src/checks.js) on the Tasks page and the attempt
 * cards: each named check's latest result, opening to the end of its output,
 * with Run for each and Run all.
 */

// Lines of output shown when a check's result is opened.
const OUTPUT_LINES = 40;
const displayName = (name) => (name === 'check' ? 'check' : name);

function runButton(label, title, onRun, { disabled = false } = {}) {
  const button = h('button', {
    type: 'button',
    class: 'btn btn-sm btn-secondary',
    title,
    disabled,
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

/** One check's latest result: a badge that opens to its command, output and Run again. */
function resultBadge(check, { busy, onRun }) {
  const { text, tone } = checkLabel(check);
  const output = String(check.output ?? '').trimEnd().split('\n').slice(-OUTPUT_LINES).join('\n');
  const when = check.finishedAt ? liveTime(check.finishedAt, 'finished ') : check.startedAt ? liveTime(check.startedAt, 'started ') : null;
  return h('details', { class: `check-status ${tone}` },
    h('summary', { title: `Ran: ${check.command}` }, text),
    h('div', { class: 'check-body' },
      h('p', { class: 'check-meta' }, h('code', {}, check.command), when && [' · ', when], ranBy(check) && ` · ${ranBy(check)}`),
      check.detail && h('p', { class: 'check-meta' }, check.detail),
      output && h('pre', { class: 'check-output' }, output),
      !busy && runButton(`Run ${displayName(check.name)} again`, `Run ${check.command} in this worktree`, () => onRun(check.name))));
}

/**
 * A worktree's checks: for each of its repo's check `names`, the latest
 * result, or Run when it has none yet; Run all for more than one.
 * `onRun(name)` starts one; `onRun()` starts them all. Null with no checks.
 */
export function checksControl(checks = [], { names = [], onRun }) {
  if (names.length === 0) return null;
  const busy = anyRunning(checks);
  const byName = new Map(checks.map((c) => [c.name, c]));
  return h('span', { class: 'checks' },
    names.map((name) => (byName.has(name)
      ? resultBadge(byName.get(name), { busy, onRun })
      : runButton(`Run ${displayName(name)}`, 'Run this check in this worktree (Settings › Checks)', () => onRun(name), { disabled: busy }))),
    names.length > 1 && runButton('Run all', 'Run each of its checks in turn', () => onRun(), { disabled: busy }));
}
