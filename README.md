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

## Acting from the dashboard (macOS)

A web page can't touch your terminal, but the switchyard server runs on your machine, so the buttons ask it to:

- **Jump** (running sessions) gets you to the session as precisely as its host app allows. switchyard finds the host by walking up the session's parent processes:
  - **iTerm / Terminal**: selects the exact tab running the session.
  - **VS Code, Cursor, Windsurf**: brings forward the window for the session's folder. You pick the terminal there.
  - **Other apps** (e.g. Codex in the ChatGPT app): brings the app to the front.

  Jump never starts anything new. A running session always has its tab, and resuming it again would create a second copy of a live session.
- **Resume** (ended sessions) opens a new tab that runs `cd <dir> && claude --resume <id>`.
- **Terminal** (worktrees, PRs) opens a new tab in that folder.
- **Code** opens the folder in your editor.
- **⧉** buttons copy the command instead, for anywhere else.

New tabs go into the front iTerm window. If iTerm has no windows, a new window opens; if it isn't running, it launches and uses the window it opens. Terminal.app always opens a new window, because it has no scriptable "new tab".

The first time you use these, macOS asks whether to let switchyard's terminal control iTerm or Terminal (System Settings → Privacy & Security → Automation).

## Configuration

Everything works without a config file. To adjust it for your machine or workplace, copy `config.example.json` to `config.json`. That file is gitignored, so workplace-specific values (your CI's job names, your team's branches) stay local. Unknown keys and invalid values stop the server at startup with a message naming the key.

| Key | Default | What it does |
|---|---|---|
| `roots` | any of `~/work`, `~/code`, `~/src`, `~/projects`, `~/dev` that exist | Directories whose child folders are scanned for repositories. `SWITCHYARD_ROOTS` (colon-separated) overrides it. |
| `port` | `4477` | Port to serve on. `PORT` overrides it. |
| `claudeDir` | `~/.claude` | Where Claude Code keeps its session registry and transcripts. |
| `ci.holdPatterns` | `\b(hold\|approve\|approval)\b`, `_hold\b`, `^hold_` | Regexes (case-insensitive) matched against the last segment of a pending check's name. A match marks that job and every pending job in the same workflow as *awaiting manual approval* rather than running. |
| `ci.stripPrefixes` | `ci/circleci: ` | Prefixes removed from check names when displayed. The full name stays in the tooltip. |
| `git.longLivedBranches` | `main`, `master`, `develop`, `dev`, `trunk` | Branches never matched to a PR by name, because PRs from forks often reuse them. `*` is a wildcard, e.g. `release/*`. |
| `github.copilotReviewer` | `copilot-pull-request-reviewer[bot]` | Reviewer login used by the Copilot review button and to recognise Copilot's reviews. |
| `terminal.app` | `auto` | Terminal used by **Resume** and **Terminal** buttons: `iTerm`, `Terminal`, or `none` to hide them. `auto` picks iTerm when switchyard was started from iTerm, otherwise Terminal. |
| `editor.urlScheme` | `vscode` | Editor opened by **Code** buttons, as a URL scheme: `vscode`, `cursor`, `vscode-insiders`, `windsurf`, or `none`. |
| `agents.parkedAfterHours` | `24` | An idle session untouched this long is *parked* rather than *waiting on you*. |
| `agents.endedHistoryDays` | `7` | How far back the Agents page lists ended sessions. |
| `agents.interruptedAttentionDays` | `3` | How long an interrupted session stays highlighted and flags its worktree. |

Lists replace the defaults rather than adding to them.

## How it stays fast and fresh

- **Pull requests are refreshed on a schedule, not on request.** The server keeps your PRs in memory and asks GitHub again based on what each PR is doing: every **20s** while its checks are running, every **2 min** once they settle, and every **60s** for the lists of which PRs exist (team requests every 5 min). A failed refresh keeps the last good data, marks the PR's "checked" time amber, and retries after 60s.
- **The pace follows who's watching.** It runs at full speed while a pull requests page is open, 3× slower while only a header badge on another page is asking, and stops entirely when no page is open. Opening the page again refreshes anything that went stale.
- **Updates are pushed, not polled.** The PR page holds a server-sent events stream (`/api/prs/stream`) and redraws when the server has new data. Each PR shows when it was last checked, and the header shows **Live · GitHub checked 12s ago**. The page closes the stream while its tab is hidden, and falls back to polling once a minute if the stream drops.
- PR lists use light `gh` fields. Asking for `statusCheckRollup` across many PRs makes GitHub's GraphQL API time out, so checks are fetched per PR. Even with several PRs running checks, this stays well under GitHub's hourly API limit.
- Worktree data sits behind a stale-while-revalidate cache, so after the first scan the page answers immediately and refreshes in the background. **Refresh** forces a full rescan.
- Transcript summaries are memoized by file size, since transcripts are append-only.

## Security

The server binds to `127.0.0.1` and rejects requests whose `Host` header isn't `localhost`/`127.0.0.1`, which blocks DNS rebinding. Responses carry a strict CSP. The API exposes local paths and your prompts, so don't proxy it anywhere.

The action endpoints (`POST /api/prs/copilot-review` and `/api/terminal/*`) also require an `Origin` matching the dashboard and an `application/json` body, so other websites open in your browser can't trigger it. They only act on things the server itself discovered. The browser names a PR, a session ID or a worktree path, never a command. The server builds every command from a fixed template, passes values to AppleScript as arguments rather than splicing them into the script, and refuses multi-line commands.
