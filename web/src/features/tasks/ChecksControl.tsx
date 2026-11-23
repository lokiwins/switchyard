import { useMutation } from '@tanstack/react-query';
import { LiveTime } from '../../components/LiveTime';
import { anyRunning, checkLabel, ranBy } from './logic';
import type { CheckResult } from './types';
import { Button } from '../../components/Button';
import { resultBodyClass, resultClass, resultMetaClass, resultSummaryClass } from './badge';

/*
 * A worktree's checks (see src/checks.js): each named check's latest result,
 * opening to the end of its output, with Run for each and Run all.
 */

// Lines of output shown when a check's result is opened.
const OUTPUT_LINES = 40;

// The end of its output, on a faint band, scrolling past a few hundred pixels.
const OUTPUT = [
  'justify-self-stretch m-0 max-h-[260px] overflow-auto py-2 px-3 rounded-[8px] text-2xs text-gray-900 whitespace-pre-wrap [overflow-wrap:anywhere]',
  'bg-[color-mix(in_srgb,var(--gray-500)_12%,transparent)]',
].join(' ');

function RunButton({ label, title, onRun, disabled = false }: { label: string; title: string; onRun: () => Promise<unknown>; disabled?: boolean }) {
  const run = useMutation({ mutationFn: onRun });
  return <Button type="button" variant="secondary" size="sm" title={title} disabled={disabled || run.isPending} onClick={() => run.mutate()}>{label}</Button>;
}

/** One check's latest result: a badge that opens to its command, output and Run again. */
function ResultBadge({ check, busy, onRun }: { check: CheckResult; busy: boolean; onRun: (name?: string) => Promise<unknown> }) {
  const { text, tone } = checkLabel(check);
  const output = String(check.output ?? '').trimEnd().split('\n').slice(-OUTPUT_LINES).join('\n');
  const when = check.finishedAt ? <LiveTime since={check.finishedAt} prefix="finished " />
    : check.startedAt ? <LiveTime since={check.startedAt} prefix="started " /> : null;
  const by = ranBy(check);
  return (
    <details className={resultClass}>
      <summary className={resultSummaryClass(tone)} title={`Ran: ${check.command}`}>{text}</summary>
      <div className={resultBodyClass}>
        <p className={resultMetaClass}><code>{check.command}</code>{when && <>{' · '}{when}</>}{by && ` · ${by}`}</p>
        {check.detail && <p className={resultMetaClass}>{check.detail}</p>}
        {output && <pre className={OUTPUT}>{output}</pre>}
        {!busy && <RunButton label={`Run ${check.name} again`} title={`Run ${check.command} in this worktree`} onRun={() => onRun(check.name)} />}
      </div>
    </details>
  );
}

/** For each of its repo's check `names`, the latest result, or Run when it has none yet; Run all for more than one. */
export function ChecksControl({ checks, names, onRun }: { checks: CheckResult[]; names: string[]; onRun: (name?: string) => Promise<unknown> }) {
  if (names.length === 0) return null;
  const busy = anyRunning(checks);
  const byName = new Map(checks.map((c) => [c.name, c]));
  return (
    // The badges share the line with the rest of the work; one opened takes a line of its own.
    <span className="flex flex-wrap items-center gap-2 min-w-0 has-[details[open]]:basis-full">
      {names.map((name) => {
        const check = byName.get(name);
        return check
          ? <ResultBadge key={name} check={check} busy={busy} onRun={onRun} />
          : <RunButton key={name} label={`Run ${name}`} title="Run this check in this worktree (Settings › Checks)" onRun={() => onRun(name)} disabled={busy} />;
      })}
      {names.length > 1 && <RunButton label="Run all" title="Run each of its checks in turn" onRun={() => onRun()} disabled={busy} />}
    </span>
  );
}
