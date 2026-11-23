import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { NAV_KEY } from '../../components/nav-api';
import { Panel } from '../../components/Panel';
import { TopBar, TopBarStatus } from '../../components/TopBar';
import { getJson, post } from '../../lib/api';
import { appearanceApi } from '../../lib/appearance';
import { cx } from '../../lib/cx';
import { shortPath } from '../../lib/paths';
import { queryClient } from '../../lib/query';
import { MODES, TERMINAL_CHOICES, THEMES } from '../../lib/themes';
import type { Nav } from '../../lib/types';
import { toast } from '../../stores/toast';
import { editsFromFields, fieldsFromValues, hasChanges, type Fields, type SettingsView } from './form';
import { RepoChecklist } from './RepoChecklist';
import { SelectSetting, settingHintClass, settingRowClass, SettingsFormProvider, TextSetting, ToggleSetting } from './SettingsForm';
import { Button } from '../../components/Button';
import { Errors, messages } from '../../components/Errors';

/* The Settings page: what's saved in config.json, edited and saved here; they apply at once. */

const SETTINGS_KEY = ['settings'] as const;

// The facts set when switchyard starts: a name, then its value in the monospace face.
const FACT_NAME = 'text-gray-500';
const FACT = 'm-0 [overflow-wrap:anywhere] font-mono';

const choices = (list: readonly { id: string; label: string }[], labelOf = (c: { id: string; label: string }) => c.label) =>
  list.map((c) => ({ value: c.id, label: labelOf(c) }));

const TERMINAL_APPS = [
  { value: 'auto', label: 'Automatic (iTerm if switchyard started there, else Terminal)' },
  { value: 'iTerm', label: 'iTerm' },
  { value: 'Terminal', label: 'Terminal' },
  { value: 'none', label: 'None (hide terminal buttons)' },
];
const WORKER_MODES = [
  { value: 'claude', label: 'Your Claude default (as your Claude settings say)' },
  { value: 'manual', label: 'Ask first (manual)' },
  { value: 'acceptEdits', label: 'Accept edits (asks before commands)' },
  { value: 'plan', label: 'Plan only (no changes)' },
  { value: 'auto', label: 'Auto (Claude decides what to ask)' },
];

async function fetchSettings(signal?: AbortSignal): Promise<SettingsView> {
  const view = await getJson<SettingsView & { nav?: Nav }>('/api/settings', signal);
  if (view.nav) queryClient.setQueryData(NAV_KEY, view.nav);
  return view;
}

function Sections({ view, saved }: { view: SettingsView; saved: Fields }) {
  return (
    <>
      <Panel id="repos-title" title="Repositories">
        <TextSetting name="roots" label="Folders to look for repos in" rows={3}
          hint="One folder per line. Leave empty to use ~/work, ~/code, ~/src, ~/projects and ~/dev, whichever exist."
          after={(
            <span className={settingHintClass} id="roots-now">
              {view.rootsFromEnv
                ? `SWITCHYARD_ROOTS is set, so it decides for now: ${view.roots.map(shortPath).join(', ')}`
                : `Looking in: ${view.roots.map(shortPath).join(', ')}`}
            </span>
          )} />
      </Panel>

      <Panel id="appearance-title" title="Appearance">
        <SelectSetting name="appearance.theme" label="Theme" options={choices(THEMES)} />
        <SelectSetting name="appearance.mode" label="Light or dark" options={choices(MODES, (m) => (m.id === 'system' ? 'Follow the system' : m.label))} />
        <SelectSetting name="appearance.terminal" label="Terminal colours" options={choices(TERMINAL_CHOICES)}
          hint="What every browser starts with. Each browser can also choose its own from the theme menu in the top bar, which wins over this. The terminal colours also tint the glass panes (the live terminal, a prompt's review, a task's details)." />
      </Panel>

      <Panel id="apps-title" title="Terminal and editor">
        <SelectSetting name="terminal.app" label="Terminal app" options={TERMINAL_APPS} hint="Where Jump, Resume and Open make tabs." />
        <TextSetting name="editor.urlScheme" label="Editor" list="editor-schemes"
          hint="The URL scheme folder links open with, e.g. vscode or cursor; none hides them.">
          <datalist id="editor-schemes">
            <option value="vscode">VS Code</option>
            <option value="cursor">Cursor</option>
            <option value="vscode-insiders">VS Code Insiders</option>
            <option value="windsurf">Windsurf</option>
            <option value="none">None</option>
          </datalist>
        </TextSetting>
      </Panel>

      <Panel id="agents-title" title="Agents">
        <div className={settingRowClass}>
          <TextSetting name="agents.parkedAfterHours" inputMode="decimal" label="Parked after (hours)"
            hint="An idle session untouched this long counts as parked, not waiting on you." />
          <TextSetting name="agents.maxRunning" inputMode="numeric" label="Most agents running at once"
            hint="0 is no limit. With one set, switchyard won't start another (New task, Start, a lead's workers, Review, Resume) while that many sessions run, yours included; it says why." />
          <TextSetting name="agents.stuckAfterMinutes" inputMode="decimal" label="Stuck after (minutes)"
            hint={<>A session working with nothing new in its transcript this long is flagged <em>Stuck?</em> on the Agents and Tasks pages (and to a lead). Only an alert. 0 is off. A long test run can look stuck too.</>} />
          <TextSetting name="agents.contextAlertTokens" inputMode="numeric" label="Flag context over (tokens)"
            hint="A session whose context is over this size is flagged, so you can /compact or start afresh. 0 is off." />
          <TextSetting name="agents.endedHistoryDays" inputMode="decimal" label="Ended sessions shown (days)" hint="How far back Recently ended goes." />
          <TextSetting name="agents.interruptedAttentionDays" inputMode="decimal" label="Interrupted needs you for (days)"
            hint="How long an interrupted session stays flagged." />
        </div>
      </Panel>

      <Panel id="providers-title" title="Agent providers">
        <div className={settingRowClass}>
          <SelectSetting name="providers.default" label="Default provider" options={[{ value: 'claude', label: 'Claude Code' }]}
            hint="The agent New task, Start and Open use when none is chosen." />
        </div>
        <h3 className="mt-5 mb-3">Claude Code</h3>
        <div className={settingRowClass}>
          <ToggleSetting name="providers.claude.enabled" label="Use Claude Code"
            hint="When off, its sessions aren't listed and it isn't offered or started. The default provider must stay on." />
          <TextSetting name="providers.claude.program" label="Program"
            hint={<>A name found on your PATH, such as <code>claude</code>, or a full path, such as <code>~/.local/bin/claude</code>.</>} />
          <TextSetting name="providers.claude.options" label="Extra options"
            hint="Added to every new and resumed session. Plain words separated by spaces; no quotes or shell syntax." />
        </div>
      </Panel>

      <Panel id="checks-title" title="Checks">
        <div className={settingRowClass}>
          <TextSetting name="checks.commands" label="Check commands (YAML)" rows={7}
            hint={(
              <>
                Each repo&apos;s folder name, then its checks indented under it as <code>name: command</code>, or just one command. Quote a command with <code>: </code> or <code>#</code> in it. To run one by itself, give it <code>command:</code> and <code>run: after-turn</code> (when an agent in a task&apos;s worktree finishes a turn) or <code>run: on-commit</code>, and optionally <code>timeout:</code> in minutes. Checks only warn; nothing is blocked when one fails.
              </>
            )} />
          <TextSetting name="checks.timeoutMinutes" inputMode="decimal" label="Stop a check after (minutes)"
            hint="A check still running then is stopped, and counts as failed." />
        </div>
      </Panel>

      <Panel id="tasks-settings-title" title="Tasks">
        <div className={settingRowClass}>
          <ToggleSetting name="tasks.autoDeleteDone" label="Delete done tasks"
            hint="Done and dropped tasks are deleted after the days set here. Their sessions end and their worktrees are removed; a worktree with uncommitted changes or unmerged commits asks you first." />
          <TextSetting name="tasks.deleteDoneAfterDays" inputMode="decimal" label="Delete done tasks after (days)"
            hint="Counted from when a task was marked done or dropped, or first seen with its PR merged." />
        </div>
      </Panel>

      <Panel id="workers-title" title="Workers">
        <p className={cx(settingHintClass, 'my-3')}>For the workers a lead starts (Start ▾ › Start as lead on the Tasks page), set as each one starts. A prompt for anything not allowed here comes to you on the dashboard; the lead never answers one.</p>
        <div className={settingRowClass}>
          <SelectSetting name="workers.permissionMode" label="Permission mode" options={WORKER_MODES}
            hint="The mode a worker starts in. Bypassing permissions isn't offered." />
          <TextSetting name="workers.allowedTools" label="Allowed without asking" rows={5}
            hint={<>Claude permission rules, one per line: a tool such as <code>Edit</code>, or what it may run, such as <code>Bash(npm test)</code>. Added to your own Claude settings&apos; rules, not instead of them.</>} />
        </div>
      </Panel>

      <Panel id="github-title" title="GitHub and CI">
        <RepoChecklist saved={saved['github.issueRepos'] ?? ''} />
        <TextSetting name="github.copilotReviewer" label="Copilot reviewer" hint="The login Copilot reviews PRs as." />
        <TextSetting name="git.longLivedBranches" label="Long-lived branches" rows={5}
          hint="Never matched to a worktree's PR. One per line; * is a wildcard, as in release/*." />
        <TextSetting name="ci.holdPatterns" label="Checks on hold" rows={3}
          hint="Regular expressions for manual approval jobs, which stay pending until approved. One per line." />
        <TextSetting name="ci.stripPrefixes" label="Check name prefixes to hide" rows={2}
          hint="Removed from check names when shown. One per line, spaces kept." />
      </Panel>

      <Panel id="startup-title" title="Set when switchyard starts">
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 mt-0 mb-2 text-sm" id="facts">
          <dt className={FACT_NAME}>Port</dt><dd className={FACT}>{String(view.port)}</dd>
          <dt className={FACT_NAME}>Claude folder</dt><dd className={FACT}>{shortPath(view.claudeDir)}</dd>
          <dt className={FACT_NAME}>Config file</dt><dd className={FACT}>{shortPath(view.configPath)}</dd>
        </dl>
        <p className={cx(settingHintClass, 'my-3')}>Change these in config.json, then restart switchyard.</p>
      </Panel>
    </>
  );
}

/** The form over what's saved: `fields` is what it shows now; null until you change something. */
function SettingsEditor({ view }: { view: SettingsView }) {
  const saved = fieldsFromValues(view.values);
  const defaults = fieldsFromValues(view.defaults);
  const [edited, setEdited] = useState<Fields | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const fields = edited ?? saved;
  const changed = hasChanges(fields, saved);
  const save = useMutation({
    mutationFn: () => post<SettingsView>('/api/settings/save', editsFromFields(fields)),
    onSuccess: (next) => {
      queryClient.setQueryData(SETTINGS_KEY, (old: SettingsView | undefined) => ({ ...old, ...next }));
      setEdited(null);
      setErrors([]);
      // This page shows the new default at once (other pages pick it up when they next load).
      appearanceApi()?.setDefaults((next.values as { appearance: Record<string, string> }).appearance);
      toast('Settings saved. They apply now.');
    },
    onError: (error) => setErrors([error.message]),
  });
  // Leaving with changes not saved asks first.
  useEffect(() => {
    if (!changed) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  const state = save.isPending ? 'Saving…' : save.isError ? 'Not saved' : changed ? 'Not saved yet' : '';
  return (
    <>
      <Errors errors={messages(errors)} bare />
      <form id="settings" className="grid grid-cols-[minmax(0,1fr)] gap-4 max-w-[760px]" noValidate onSubmit={submit}>
        <SettingsFormProvider value={{
          fields,
          defaults,
          set: (name, value) => {
            // A change after a failed save is a new edit, not yet saved.
            if (save.isError) save.reset();
            setEdited({ ...fields, [name]: value });
          },
        }}>
          <Sections view={view} saved={saved} />
        </SettingsFormProvider>
        <div className="flex gap-2 items-center">
          <Button type="submit"  id="save" disabled={!changed || save.isPending}>Save</Button>
          <Button type="button" variant="secondary" id="revert" disabled={!changed} onClick={() => {
            setEdited(null);
            setErrors([]);
            save.reset();
          }}>Undo changes</Button>
          <span className="text-gray-500" id="save-state" aria-live="polite">{state}</span>
        </div>
      </form>
    </>
  );
}

export function SettingsPage() {
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: ({ signal }) => fetchSettings(signal), staleTime: Infinity, refetchOnWindowFocus: false });
  return (
    <>
      <TopBar current="/settings">
        <TopBarStatus>{settings.data || settings.error ? '' : 'Loading…'}</TopBarStatus>
      </TopBar>
      <main>
        {settings.error && <Errors errors={messages([settings.error.message])} bare />}
        {settings.data && <SettingsEditor view={settings.data} />}
      </main>
    </>
  );
}

