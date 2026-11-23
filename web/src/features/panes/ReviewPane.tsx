import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Dialog, PaneHeader } from '../../components/Dialog';
import { paneBodyClass, paneButtonClass, paneCodeClass, paneFooterClass, paneInputClass, paneNoteClass, panePillClass, paneTabClass } from '../../components/pane-classes';
import { cx } from '../../lib/cx';
import { Markdown } from '../../components/Markdown';
import { getJson } from '../../lib/api';
import { announceChange } from '../../lib/changes';
import { sessionTitle } from '../../lib/shared';
import type { Approval, LiveSession } from '../../lib/types';
import { usePaneStore } from '../../stores/panes';
import { toast } from '../../stores/toast';
import { decide } from '../agents/controls/approvals';

/*
 * "Review": a waiting permission prompt in the glass pane, in full, before you
 * allow it. The diff an Edit or Write would make (with a rendered preview for
 * Markdown), the whole command for Bash, or the tool's input; then Allow, or
 * Deny with an optional reason Claude can act on.
 */

// More lines than this would make the page sluggish; the rest is left to the terminal.
const MAX_DIFF_LINES = 5000;
const MAX_REASON_CHARS = 500;
const SIGNS = { '+': '+', '-': '−', ' ': ' ' } as const;
/* Each line's tint and text colour: added green, removed red, context plain. */
const LINE_TONES = {
  '+': { line: 'bg-[color-mix(in_srgb,var(--pane-ok)_13%,transparent)]', text: 'text-[var(--pane-add-text)]' },
  '-': { line: 'bg-[color-mix(in_srgb,var(--pane-bad)_13%,transparent)]', text: 'text-[var(--pane-del-text)]' },
  ' ': { line: '', text: '' },
} as const;
const DIFF_NUM = 'pr-2 text-right text-[color-mix(in_srgb,var(--pane-dim)_60%,transparent)] select-none';

interface DiffLine { type: '+' | '-' | ' '; old?: number | null; new?: number | null; text: string }
interface Hunk { oldStart?: number; newStart?: number; lines: DiffLine[] }
interface Diff { hunks: Hunk[]; added: number; removed: number; approximate?: boolean }
type ApprovalDetail =
  | { kind: 'diff'; toolName: string; diff: Diff; markdown: string | null; note?: string | null; isNewFile?: boolean }
  | { kind: 'command'; toolName: string; command: string }
  | { kind: 'input'; toolName: string; text: string };

/** The hunks, up to MAX_DIFF_LINES lines in all. */
function DiffView({ diff }: { diff: Diff }) {
  if (diff.hunks.length === 0) return <p className={paneNoteClass}>This doesn&apos;t change the file&apos;s text.</p>;
  let budget = MAX_DIFF_LINES;
  const shown = diff.hunks.flatMap((hunk) => {
    if (budget <= 0) return [];
    const lines = hunk.lines.slice(0, budget);
    budget -= lines.length;
    return [{ ...hunk, lines }];
  });
  const total = diff.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  return (
    <div className="font-mono text-xs leading-[1.5]">
      {shown.map((hunk, h) => (
        <div key={h} className="mb-3 border border-[color-mix(in_srgb,var(--pane-accent)_12%,transparent)] rounded-[8px] overflow-hidden">
          <div className="py-0.5 px-2.5 bg-[color-mix(in_srgb,var(--pane-accent)_8%,transparent)] text-pane-dim">{`@@ −${hunk.oldStart ?? 0} +${hunk.newStart ?? 0} @@`}</div>
          {hunk.lines.map((line, i) => (
            <div key={i} className={cx('grid grid-cols-[3.5em_3.5em_1.5em_1fr]', LINE_TONES[line.type].line)}>
              <span className={DIFF_NUM}>{line.old ?? ''}</span>
              <span className={DIFF_NUM}>{line.new ?? ''}</span>
              <span className={cx('text-center select-none', LINE_TONES[line.type].text)}>{SIGNS[line.type]}</span>
              <span className={cx('whitespace-pre-wrap [word-break:break-word]', LINE_TONES[line.type].text)}>{line.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
      {total > MAX_DIFF_LINES && <p className={paneNoteClass}>{`${total - MAX_DIFF_LINES} more lines aren't shown here; the terminal's prompt has the rest.`}</p>}
    </div>
  );
}

/** Diff, and Rendered for Markdown, as tabs over one body. */
function DiffDetail({ detail }: { detail: Extract<ApprovalDetail, { kind: 'diff' }> }) {
  const [view, setView] = useState<'diff' | 'rendered'>('diff');
  const views = detail.markdown === null ? (['diff'] as const) : (['diff', 'rendered'] as const);
  return (
    <>
      {detail.note && <p className={paneNoteClass}>{detail.note}</p>}
      {detail.diff.approximate && <p className={paneNoteClass}>Too big to compare line by line: the changed part is shown removed and re-added.</p>}
      {views.length > 1 && (
        <div className="flex gap-1.5 mb-2.5" role="group" aria-label="View">
          {views.map((name) => (
            <button key={name} type="button" className={paneTabClass} aria-pressed={view === name} onClick={() => setView(name)}>
              {name === 'diff' ? 'Diff' : 'Rendered'}
            </button>
          ))}
        </div>
      )}
      <div>
        {view === 'rendered' && detail.markdown !== null ? <Markdown text={detail.markdown} /> : <DiffView diff={detail.diff} />}
      </div>
    </>
  );
}

function pillText(detail: ApprovalDetail | undefined, fallback: string): string {
  if (!detail || detail.kind !== 'diff') return detail?.toolName ?? fallback;
  if (detail.isNewFile) return `new file · +${detail.diff.added}`;
  return `+${detail.diff.added} −${detail.diff.removed}`;
}

export function ReviewPane({ approval, session }: { approval: Approval; session: LiveSession }) {
  const close = usePaneStore((s) => s.close);
  const [reason, setReason] = useState('');
  const detail = useQuery({
    queryKey: ['approval-detail', approval.id],
    queryFn: ({ signal }) => getJson<ApprovalDetail>(`/api/approvals/detail?id=${encodeURIComponent(approval.id)}`, signal),
    staleTime: Infinity,
    retry: false,
  });
  const answer = useMutation({
    mutationFn: (behavior: 'allow' | 'deny') => decide(approval, behavior, behavior === 'deny' ? reason.trim() || undefined : undefined),
    onSuccess: (message) => {
      toast(message);
      close();
      void announceChange();
    },
    onError: (error) => toast(error.message),
  });
  const body = (() => {
    if (detail.error) return <p className={paneNoteClass}>{detail.error.message}</p>;
    if (!detail.data) return <p className={paneNoteClass}>Loading…</p>;
    if (detail.data.kind === 'diff') return <DiffDetail detail={detail.data} />;
    return <pre className={paneCodeClass}>{detail.data.kind === 'command' ? detail.data.command : detail.data.text}</pre>;
  })();
  return (
    <Dialog label={`Review: ${approval.toolName} ${approval.summary}`} onClose={close}>
      <PaneHeader heading={`${approval.toolName} · ${sessionTitle(session)}`} sub={approval.summary} dot="waiting">
        <span className={panePillClass}>{pillText(detail.data, approval.toolName)}</span>
        <button type="button" className={paneButtonClass()} title="Close (the prompt keeps waiting)" onClick={close}>Close</button>
      </PaneHeader>
      <div className={paneBodyClass}>{body}</div>
      <footer className={paneFooterClass}>
        <input type="text" className={paneInputClass()} maxLength={MAX_REASON_CHARS} autoComplete="off" value={reason} onChange={(event) => setReason(event.target.value)}
          placeholder="Reason (optional): tell Claude what to do instead" />
        <button type="button" className={paneButtonClass()} title="Deny; with a reason, Claude adjusts instead of stopping" disabled={answer.isPending}
          onClick={() => answer.mutate('deny')}>Deny</button>
        <button type="button" className={paneButtonClass({ primary: true })} title="Allow once" disabled={answer.isPending} onClick={() => answer.mutate('allow')}>Allow</button>
      </footer>
    </Dialog>
  );
}
