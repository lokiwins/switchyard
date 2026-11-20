import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Markdown } from '../../components/Markdown';
import { getJson, post } from '../../lib/api';
import { cx } from '../../lib/cx';
import { queryClient } from '../../lib/query';
import { statusStyle } from '../../lib/status-style';
import { toast } from '../../stores/toast';
import { ticketLabel, trackerOf } from '../tasks/logic';

/*
 * One linked ticket in the task pane: what its tracker says about it (ClickUp's
 * from ClickUp, GitHub's through gh), changing its status from here, or a link
 * to it where switchyard can't read it.
 */

const TRACKER_NAMES: Record<string, string> = { clickup: 'ClickUp', github: 'GitHub', jira: 'Jira', ado: 'Azure DevOps' };
const trackerName = (tracker: string | null | undefined) => (tracker ? TRACKER_NAMES[tracker] : undefined);

interface TicketStatus { name: string; color?: string | null }
interface ReadTicket {
  supported?: true;
  tracker?: string;
  name?: string;
  title?: string;
  status: TicketStatus;
  statuses?: TicketStatus[];
  description?: string | null;
}
type TicketDetail = { supported: false; tracker?: string } | ReadTicket;

const ticketKey = (link: string) => ['hub-ticket', link] as const;
const ticketTitle = (ticket: ReadTicket) => ticket.name ?? ticket.title ?? '';

const StatusPill = ({ status }: { status: TicketStatus }) => (
  <span className="pane-pill ticket-pane-status" style={statusStyle(status.color)}>{status.name || 'no status'}</span>
);

/** Status ▾: the statuses a ticket can move to (a ClickUp list's, or an issue's open/closed); choosing one changes it there. */
function StatusPicker({ link, ticket, statuses }: { link: string; ticket: ReadTicket; statuses: TicketStatus[] }) {
  const title = ticketTitle(ticket);
  const change = useMutation({
    mutationFn: (status: string) => post<ReadTicket>('/api/hub/ticket/status', { url: link, status }),
    onSuccess: (updated) => {
      toast(`${trackerName(ticket.tracker) ?? 'It'}: ${title} is now ${updated.status.name}`);
      queryClient.setQueryData(ticketKey(link), updated);
    },
    // The select shows the ticket's status again, as it's drawn from the ticket.
    onError: (error) => toast(error.message),
  });
  return (
    <select
      className="pane-select"
      aria-label={`Status in ${trackerName(ticket.tracker) ?? 'its tracker'}: ${title}`}
      value={change.isPending ? change.variables : ticket.status.name}
      disabled={change.isPending}
      onChange={(event) => change.mutate(event.target.value)}
    >
      {statuses.map((status) => <option key={status.name} value={status.name}>{status.name}</option>)}
    </select>
  );
}

const TicketBody = ({ ticket }: { ticket: ReadTicket }) => (
  <>
    <h3 className="pane-ticket-title">{ticketTitle(ticket)}</h3>
    {ticket.description ? <Markdown text={ticket.description} /> : <p className="pane-note">No description.</p>}
  </>
);

export function TicketCard({ link }: { link: string }) {
  const tracker = trackerOf(link);
  const query = useQuery({
    queryKey: ticketKey(link),
    queryFn: ({ signal }) => getJson<TicketDetail>(`/api/hub/ticket?url=${encodeURIComponent(link)}`, signal),
    retry: false,
  });
  const head = (extra?: ReactNode) => (
    <header className="pane-ticket-head">
      <span className="pane-ticket-label">{ticketLabel(link)}</span>
      {extra}
      <a href={link} target="_blank" rel="noopener noreferrer" className="pane-link">{`Open in ${trackerName(tracker) ?? 'its tracker'} ↗`}</a>
    </header>
  );
  const ticket = query.data;
  let content: ReactNode;
  if (query.error) content = <>{head()}<p className="pane-note">{query.error.message}</p></>;
  else if (!ticket) content = <>{head()}<p className="pane-note">Loading…</p></>;
  else if (ticket.supported === false) {
    content = <>{head()}<p className="pane-note">{`switchyard doesn't read ${trackerName(ticket.tracker) ?? 'this site'} yet; open it to see it.`}</p></>;
  } else {
    const statuses = ticket.statuses ?? [];
    content = (
      <>
        {head(<>
          <StatusPill status={ticket.status} />
          {statuses.length > 0 && <StatusPicker link={link} ticket={ticket} statuses={statuses} />}
        </>)}
        <TicketBody ticket={ticket} />
      </>
    );
  }
  return <article className={cx('pane-ticket', tracker && `is-${tracker}`)}>{content}</article>;
}
