import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Menu } from '../../components/Menu';
import { cx } from '../../lib/cx';
import { changeTools, useTaskTools } from './api';
import type { TaskTool } from './types';
import { Button } from '../../components/Button';
import { Pill } from '../../components/Pill';
import { Dot } from '../../components/Dot';
import { lineFormClass, lineInputClass } from '../../components/Field';

/*
 * Connections ▾ in the header: which trackers are connected, and a card for
 * each to connect it (ClickUp by token, GitHub through your gh login).
 */

const HELP_URL = 'https://app.clickup.com/settings/apps';

const ConnectedDot = () => <Dot state="connected" />;

/** The token form on the ClickUp card, before it's connected. */
function ConnectForm() {
  const [token, setToken] = useState('');
  const connect = useMutation({
    mutationFn: (value: string) => changeTools('/api/task-tools/connect', { tool: 'clickup', token: value }, 'Connected to ClickUp'),
    // Kept after a failure, so a mistyped token can be fixed rather than pasted again.
    onSuccess: (connected) => {
      if (connected) setToken('');
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    connect.mutate(token);
  };
  return (
    <form className="tool-connect" onSubmit={submit}>
      <label className="tool-label" htmlFor="clickup-token">Personal API token</label>
      <div className={lineFormClass}>
        <input
          className={lineInputClass}
          id="clickup-token" name="token" type="password" required autoComplete="off" spellCheck={false} placeholder="pk_…"
          value={token} onChange={(event) => setToken(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={connect.isPending}>Connect</Button>
      </div>
      <p className="tool-help">
        Make one in ClickUp under <a href={HELP_URL} target="_blank" rel="noopener noreferrer">Settings › Apps</a>
        . switchyard keeps it in ~/.config/switchyard, readable only by you, and sends it only to ClickUp.
      </p>
    </form>
  );
}

function WorkspacePicker({ tool }: { tool: TaskTool }) {
  const workspaces = tool.workspaces ?? [];
  const pick = useMutation({
    mutationFn: (workspaceId: string) => changeTools('/api/task-tools/workspace', { tool: 'clickup', workspaceId }),
  });
  const [only] = workspaces;
  if (only && workspaces.length === 1) return <span className="tool-meta">{only.name}</span>;
  // Drawn from the tools, so a failed change puts the select back.
  return (
    <select
      className="tool-select"
      aria-label="ClickUp workspace"
      value={pick.isPending ? pick.variables : tool.workspaceId ?? ''}
      onChange={(event) => pick.mutate(event.target.value)}
    >
      {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
  );
}

function ConnectedBody({ tool }: { tool: TaskTool }) {
  const disconnect = () => void changeTools('/api/task-tools/disconnect', { tool: 'clickup' }, 'Disconnected from ClickUp');
  return (
    <>
      <p className="tool-meta"><ConnectedDot />{`Connected as ${tool.user?.username ?? ''}`}</p>
      <div className="tool-row">
        <WorkspacePicker tool={tool} />
        <Button type="button" variant="secondary" size="sm" title="Forget the token" onClick={disconnect}>Disconnect</Button>
      </div>
    </>
  );
}

/** GitHub's card: it uses your gh login, so there's nothing to paste, only to sign in to gh. */
function GhBody({ tool }: { tool: TaskTool }) {
  if (tool.connected) return <p className="tool-meta"><ConnectedDot />{`Signed in to gh as ${tool.user?.username ?? ''}`}</p>;
  return <p className="tool-help">Uses your GitHub CLI login. Run <code>gh auth login</code> in a terminal, then press Refresh.</p>;
}

function ToolBody({ tool }: { tool: TaskTool }) {
  if (tool.kind === 'gh') return <GhBody tool={tool} />;
  return tool.connected ? <ConnectedBody tool={tool} /> : <ConnectForm />;
}

/** One card per tracker: to connect, connected, or coming soon. */
const ToolCard = ({ tool }: { tool: TaskTool }) => (
  <article className={cx('tool-card', tool.connected && 'is-connected', !tool.available && 'is-later')}>
    <header className="tool-head">
      <h3>{tool.name}</h3>
      {!tool.available && <Pill>Coming soon</Pill>}
    </header>
    {tool.available && <ToolBody tool={tool} />}
  </article>
);

export function ConnectionsMenu() {
  const { data: tools } = useTaskTools();
  if (!tools) return null;
  const connected = tools.filter((tool) => tool.connected);
  return (
    <Menu
      label={<><Dot state={connected.length > 0 ? 'connected' : null} /> Connections ▾</>}
      title={connected.length ? `Connected: ${connected.map((tool) => tool.name).join(', ')}` : 'No tracker connected'}
      look={{ variant: 'secondary' }}
      triggerClass="inline-flex items-center gap-1.5"
      panelClass="connections-panel"
    >
      {tools.map((tool) => <ToolCard key={tool.id} tool={tool} />)}
    </Menu>
  );
}
