# switchyard

A local status board for parallel development: your running AI agent sessions, your git worktrees, and your pull requests, side by side.

```bash
npm start          # http://localhost:4477
npm test
```

Requires Node 20+, `git`, and an authenticated `gh` CLI. There are no npm dependencies.

## What it shows

Three pages share a header nav. Each nav link carries a badge counting what needs you there: **Agents** shows sessions waiting on you plus recent interruptions (amber), and **Pull requests** shows PRs needing fixes (red) or review requests (purple).

### Agents page (`/`, the landing page)

- **Running:** every live Claude Code session, read from `~/.claude/sessions/*.json`. A session counts as running only if its process is alive *and* started when the registry says it did, so a reused process ID can't make a dead session look alive. *Working* and *waiting* sessions come first. *Parked* sessions (idle over a day) collapse behind a toggle.
- **Recently ended:** sessions from the last 7 days that are no longer running, labelled by how their last turn ended:
  - *Interrupted*: the terminal closed mid-turn (an unanswered prompt, a tool call with no result, or a tool result never continued from)
  - *Stopped* (Esc), *Exited* (`/exit`), or *Finished*

  Interruptions from the last 3 days are highlighted and flag their worktree. Sessions that never received a prompt are hidden.
- **Filters and search:** tiles and a segmented control for All / Working / Waiting / Interrupted / Parked / Ended, plus search across name, repo, branch, folder and prompt. Click a prompt to expand it in place.
- Each row has `cd` and resume (`cd <dir> && claude --resume <id>`) copy buttons, plus a link to the worktree's PR when there is one.

### Worktrees page (`/worktrees`)

- Every repository under your roots, grouped by repository. Each worktree shows:
  - uncommitted, untracked and conflicted files, and whether it is ahead of or behind upstream
  - the matching PR (open, draft, merged or closed), its checks, review decision and merge conflicts
  - the agents running in it, or its most recent past session
- **Views:** *Active*, *Needs attention* (failing checks, changes requested, merge conflict, git conflicts, an agent waiting or recently interrupted), *Agents*, *Clean up* (PR merged or closed, worktree clean, no agent), and *All*. Each row in *Clean up* has a copyable `git worktree remove` command. Nothing is ever run for you.
- **My open PRs without a local worktree.**

### Pull requests page (`/prs`)

- **My pull requests** and **review requested from you** (direct requests), sorted most urgent first. Each PR has one headline status: merge conflict, checks failing, changes requested, ready to merge, approved but blocked, behind base, checks running, awaiting review, or draft.
- **Checks:** passed, failed and running counts, with the failing checks named and linked. Superseded re-runs are ignored. CI workflows waiting on a manual approval job (CircleCI `hold`/`Approve …`) count as *awaiting manual approval* rather than running, including the jobs queued behind the hold.
- **Reviews:** each reviewer's latest verdict, plus outstanding user and team requests.
- **Local:** the worktree where the branch is checked out, any agents working in it, and a `cd` command. If it isn't checked out, a `gh pr checkout` command instead.
- **Copilot review button** on your own PRs: *Request* / *Re-request Copilot review* (the tooltip shows when Copilot last reviewed). It calls `POST repos/{repo}/pulls/{n}/requested_reviewers` with `copilot-pull-request-reviewer[bot]` through `gh api`. While a request is outstanding, the button is disabled.
- **Requested from your teams:** a lighter, collapsible list of PRs waiting on a team you're in.

## Configuration

Copy `config.example.json` to `config.json` (gitignored) or use environment variables:

| Setting | Env | Default |
|---|---|---|
| `roots`: directories whose child folders are scanned for repositories | `SWITCHYARD_ROOTS` (colon-separated) | any of `~/work`, `~/code`, `~/src`, `~/projects`, `~/dev` that exist |
| `port` | `PORT` | `4477` |
| `claudeDir` | — | `~/.claude` |

## How it stays fast

- PR lists use light `gh pr list` fields. Asking for `statusCheckRollup` across many PRs makes GitHub's GraphQL API time out, so checks are fetched per PR, and only for open PRs that map to a local worktree.
- GitHub is only queried for repositories that have linked worktrees, a live agent, or one of your open PRs.
- All data sits behind a stale-while-revalidate cache, so after the first scan the page answers immediately and refreshes in the background. The **Refresh** button forces a full rescan.
- Transcript summaries are memoized by file size, since transcripts are append-only.

## Security

The server binds to `127.0.0.1` and rejects requests whose `Host` header isn't `localhost`/`127.0.0.1`, which blocks DNS rebinding. Responses carry a strict CSP. The API exposes local paths and your prompts, so don't proxy it anywhere.

The only action endpoint, `POST /api/prs/copilot-review`, also requires an `Origin` matching the dashboard and an `application/json` body, so other websites open in your browser can't trigger it. It only acts on PRs currently listed on the PR page.
