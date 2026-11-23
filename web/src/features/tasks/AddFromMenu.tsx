import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Menu, menuItemCenteredClass, menuMetaClass, MenuTitle } from '../../components/Menu';
import { readPref, writePref } from '../../lib/prefs';
import { statusStyle } from '../../lib/status-style';
import { fetchTickets, useTaskTools } from './api';
import { matchesTicket, taskFromTicket, unlinkedTickets } from './ticket-import';
import type { HubTask, TaskFields, TaskTool, Ticket } from './types';
import { Pill } from '../../components/Pill';
import { Dot } from '../../components/Dot';

/*
 * Add from ▾: a tab per tracker, each listing the open tickets assigned to
 * you there that no task links yet. Clicking one makes a task of it, and it
 * drops off the list once the tasks reload, so several can be added in a row.
 */

// A tracker's tab; the one shown is raised.
const TAB = [
  'inline-flex items-center gap-[5px] py-[3px] px-2.5 border-0 rounded-xs [font-family:inherit] [line-height:inherit] text-xs font-medium',
  'text-gray-500 bg-transparent cursor-pointer hover:text-gray-900',
  'aria-selected:bg-surface aria-selected:text-gray-900 aria-selected:shadow-[var(--shadow-sm),inset_0_0_0_1px_var(--hairline)]',
].join(' ');
const FILTER = [
  '[font-family:inherit] [line-height:inherit] text-sm py-[5px] px-2.5 border-0 rounded-sm',
  'bg-surface-sunken text-gray-900 shadow-[inset_0_0_0_1px_var(--divider)]',
].join(' ');

// The tracker tab Add from ▾ opened on last.
const IMPORT_TAB_PREF = 'switchyard.importTab';

type Create = (fields: TaskFields) => Promise<boolean>;

/** What to do when a tracker isn't connected yet. */
function ConnectHint({ tool }: { tool: TaskTool }) {
  if (tool.id === 'github') return <>Sign in to the GitHub CLI first: run <code>gh auth login</code> in a terminal, then try again.</>;
  return <>{`Connect ${tool.name} first, in the Connections ▾ menu at the top of the page.`}</>;
}

const Note = ({ children }: { children: ReactNode }) => <p className="my-1.5 mx-1 text-xs text-gray-500">{children}</p>;

const TicketStatus = ({ status }: { status: Ticket['status'] }) => (
  <Pill tone="status" className="flex-none uppercase tracking-[0.02em]" title={`Status: ${status.name}`} style={statusStyle(status.color)}>{status.name}</Pill>
);

function TicketList({ tool, tasks, query, onCreate }: { tool: TaskTool; tasks: HubTask[]; query: string; onCreate: Create }) {
  // Keyed by tracker, so a slow tracker's answer can't land in another tab.
  const tickets = useQuery({ queryKey: ['task-tickets', tool.id], queryFn: () => fetchTickets(tool.id), retry: false });
  // Tickets being made into tasks; one that worked stays disabled until the tasks reload and it drops off.
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  if (tickets.error) return <Note>{`${tool.name}: ${tickets.error.message}`}</Note>;
  if (!tickets.data) return <Note>{`Loading your ${tool.name} tickets…`}</Note>;
  if (!tickets.data.connected) return <Note><ConnectHint tool={tool} /></Note>;
  if (tickets.data.error) return <Note>{`${tool.name}: ${tickets.data.error}`}</Note>;
  const offered = unlinkedTickets(tickets.data.tasks, tasks).filter((t) => matchesTicket(t, query));
  if (offered.length === 0) {
    return <Note>{query ? `No tickets match “${query}”.` : `Every ${tool.name} ticket assigned to you is already a task.`}</Note>;
  }
  const add = async (ticket: Ticket) => {
    setAdding((ids) => new Set(ids).add(ticket.id));
    if (await onCreate(taskFromTicket(ticket))) return;
    setAdding((ids) => new Set([...ids].filter((id) => id !== ticket.id)));
  };
  return offered.map((ticket) => (
    <button
      key={ticket.id}
      type="button"
      className={menuItemCenteredClass}
      role="menuitem"
      title={`Add a task for ${ticket.name}`}
      disabled={adding.has(ticket.id)}
      onClick={() => void add(ticket)}
    >
      <TicketStatus status={ticket.status} />
      <MenuTitle>{ticket.name}</MenuTitle>
      <span className={menuMetaClass}>{[ticket.customId ?? ticket.id, ticket.where].filter(Boolean).join(' · ')}</span>
    </button>
  ));
}

/** The last tab used, else the first connected tracker, else the first. */
const firstTool = (tools: TaskTool[]) => tools.find((t) => t.id === readPref(IMPORT_TAB_PREF)) ?? tools.find((t) => t.connected) ?? tools[0];

/** The menu's inside, drawn only while it's open, so it opens on the remembered tab and loads only then. */
function Picker({ tools, tasks, onCreate }: { tools: TaskTool[]; tasks: HubTask[]; onCreate: Create }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Worked out as it's drawn, so trackers that load after it opened still get a tab picked.
  const tool = tools.find((t) => t.id === picked) ?? firstTool(tools) ?? null;
  const pick = (id: string) => {
    writePref(IMPORT_TAB_PREF, id);
    setPicked(id);
  };
  return (
    <>
      <div className="flex flex-wrap gap-0.5 p-0.5 rounded-sm bg-surface-sunken shadow-[inset_0_0_0_1px_var(--divider)]" role="tablist" aria-label="Tracker">
        {tools.map((t) => (
          <button key={t.id} type="button" role="tab" className={TAB} aria-selected={t.id === tool?.id} onClick={() => pick(t.id)}>
            {t.connected && <Dot state="connected" />}
            {t.name}
          </button>
        ))}
      </div>
      <input
        type="search"
        className={FILTER}
        placeholder="Filter name, id, status, where…"
        aria-label="Filter tickets"
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        // It sits with the add-a-task form: Enter here mustn't add a task.
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
      />
      <div className="grid max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain" role="tabpanel">
        {tool
          ? <TicketList tool={tool} tasks={tasks} query={query.trim()} onCreate={onCreate} />
          : <Note>No tracker to import from yet.</Note>}
      </div>
    </>
  );
}

export function AddFromMenu({ tasks, onCreate }: { tasks: HubTask[]; onCreate: Create }) {
  const { data } = useTaskTools();
  const tools = (data ?? []).filter((tool) => tool.available);
  return (
    <Menu
      label="Add from ▾"
      title="Make tasks from the tickets assigned to you in your trackers"
      look={{ variant: 'secondary' }}
      roomy
      width={[360, 520]}
      // A set width: it's placed under its button when it opens, before the tickets load, so it mustn't grow after.
      panelClass="w-[min(520px,calc(100vw-16px))] gap-1.5"
    >
      <Picker tools={tools} tasks={tasks} onCreate={onCreate} />
    </Menu>
  );
}
