import { useQuery } from '@tanstack/react-query';
import { getJson } from '../../lib/api';
import { settingCheckboxClass, SettingGroup, settingHintClass, useSettingField } from './SettingsForm';
import { cx } from '../../lib/cx';

/* Which repos Add from ▾ → GitHub lists your issues from: the repos your issues are in, and the ones in your folders. */

interface RepoChoice { name: string; issues: number; local: boolean }
interface RepoChoices { repos: RepoChoice[]; connected: boolean; error?: string | null }

const FIELD = 'github.issueRepos';
const linesOf = (text: string) => text.split('\n').filter(Boolean);
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((name) => b.some((other) => other.toLowerCase() === name.toLowerCase()));

function repoNote(repo: RepoChoice): string {
  const issues = repo.issues > 0 ? `${repo.issues} issue${repo.issues > 1 ? 's' : ''} for you` : null;
  return [issues, repo.local ? 'in your folders' : null].filter(Boolean).join(' · ') || 'chosen before';
}

const Hint = ({ text, className }: { text: string; className?: string }) => <span className={cx(settingHintClass, className)}>{text}</span>;

/** The checklist; `saved` is the field as saved, so ticking back to it reads as no change. */
export function RepoChecklist({ saved }: { saved: string }) {
  const field = useSettingField(FIELD);
  const choices = useQuery({
    queryKey: ['settings', 'github-repos'],
    queryFn: ({ signal }) => getJson<RepoChoices>('/api/settings/github-repos', signal),
    staleTime: Infinity,
    retry: false,
  });
  const chosen = linesOf(field.value).map((name) => name.toLowerCase());
  // The ticked repos, in the list's order; ticking back to what's saved reads as no change.
  const tick = (repos: RepoChoice[], name: string, on: boolean) => {
    const ticked = repos.map((r) => r.name).filter((n) => (n === name ? on : chosen.includes(n.toLowerCase())));
    field.set(sameSet(ticked, linesOf(saved)) ? saved : ticked.join('\n'));
  };
  const body = (() => {
    if (choices.error) return <Hint text={`Couldn't list repos: ${choices.error.message}`} />;
    if (!choices.data) return <Hint text="Loading repos…" />;
    const { repos, connected, error } = choices.data;
    return (
      <>
        {!connected && <Hint text="gh isn't signed in, so only the repos in your folders are listed (run gh auth login)." />}
        {error && <Hint text={`GitHub: ${error}`} />}
        {repos.length === 0 ? <Hint text="No GitHub repos found yet." /> : repos.map((repo) => (
          <label key={repo.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0 py-0.5 cursor-pointer text-sm">
            <input type="checkbox" className={settingCheckboxClass} value={repo.name} checked={chosen.includes(repo.name.toLowerCase())} onChange={(event) => tick(repos, repo.name, event.target.checked)} />
            <span className="text-base font-bold tracking-[-0.01em] text-gray-900 [overflow-wrap:anywhere]">{repo.name}</span>
            <Hint text={repoNote(repo)} className="ml-auto" />
          </label>
        ))}
      </>
    );
  })();
  return (
    <SettingGroup legend="Repos in the GitHub issues list">
      <div className="grid gap-0.5 max-w-[520px] max-h-[260px] overflow-y-auto py-1 px-2 rounded-sm shadow-[inset_0_0_0_1px_var(--gray-200)]" id="issue-repos">{body}</div>
      <span className={settingHintClass}>Which repos Add from ▾ → GitHub on the Tasks page lists your issues from. None ticked lists them all.</span>
    </SettingGroup>
  );
}
