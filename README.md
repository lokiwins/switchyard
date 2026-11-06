# switchyard

[![Tests](https://github.com/lokiwins/switchyard/actions/workflows/test.yml/badge.svg)](https://github.com/lokiwins/switchyard/actions/workflows/test.yml)

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
  - **tmux**: switches the session to the task's window, then selects the tab the session is attached in, or attaches it (`tmux attach-session -t =<session>`) in a new tab.
  - **VS Code, Cursor, Windsurf**: brings forward the window for the session's folder. You pick the terminal there.
  - **Other apps** (e.g. Codex in the ChatGPT app): brings the app to the front.

  If the session's tab was closed, Jump resumes it in a new tab instead.
- **Allow / Deny** appear on a session waiting on a permission prompt, showing what Claude wants to run or touch. Allow runs it once. Deny stops Claude to wait for you, like "No" in the terminal. The terminal's own prompt stays open the whole time, and whichever you answer first wins. This needs a one-time hook (see below).
- **Reply ▾** (sessions in tmux or iTerm) types a one-line message into the session and presses Return, as if you'd typed it there. A message sent while Claude is working is queued until its current step finishes. It's refused while a question or prompt is open, because the text would answer it. It lands after anything already typed in its input box. tmux sessions get it through `tmux send-keys`, so they don't need to be attached or have a tab.
- **Stop** (working sessions in tmux) presses Esc in the session, ending Claude's current turn as it would in the terminal.
- **Terminal** (sessions in tmux) opens the session live in a pane over the right half of the page. You see exactly what its terminal shows and can type into it: keys, Esc, arrows, menus and pastes all reach Claude as if you were attached. The tmux window takes the pane's size, and follows if you resize the browser. If a terminal tab attached to the same session takes the size back, the pane follows that instead. If the page falls behind a flood of output (or sits in a background tab), switchyard pauses the pane in tmux once about 512 KB is waiting, and redraws it from tmux's copy of the screen when the page catches up, so nothing is missing and typing stays responsive. If the connection drops, for example when switchyard restarts, the pane reconnects by itself and redraws; if the session has ended it says so and offers Reconnect. Closing the pane leaves the session running. It draws with [xterm.js](https://xtermjs.org) (vendored in `public/vendor/xterm`, loaded only when you open one) and needs WebGL.
- **Resume** (ended sessions) opens a new tab that runs `cd <dir> && claude --resume <id>`.
- **Terminal** (worktrees, PRs) opens a new tab in that folder.
- **Code** opens the folder in your editor.
- **⧉** buttons copy the command instead, for anywhere else.

### New task (needs tmux)

**New task ▾** on the Agents page starts Claude on a task, in its own worktree on its own branch. You say what the task is; the branch is optional:

1. Picks the branch. Left empty, it's named after the task: its first few meaningful words, lowercase and hyphenated ("Fix the login redirect on the settings page" becomes `fix-login-redirect-settings-page`), with `-2`, `-3`… added if a branch, folder or tab of that name already exists, so it's always a new branch. The form shows the name as you type.
2. Creates the worktree beside the repo as `<repo>-<last branch segment>` (`fix/login` in `my-repo` becomes `my-repo-login`). A branch you name that exists locally is checked out. A branch that only exists on origin is checked out tracking it. Otherwise a new branch starts from origin's default branch, fetched first, without tracking it, so a push can't land on main. If tmux fails to start the window, the new worktree is removed again so you can retry.
3. Opens a window (tab) of the same name in the `switchyard` tmux session, starting the session if it isn't running, and types `claude` in it with your task as the first prompt. The window opens in the background, so if you're attached you stay where you are. Its shell starts from the same PATH as a new terminal tab, so `claude` there is the one your terminal runs, even when switchyard itself runs under a Node version manager. Every task is a tab in that one session: attach once (`tmux attach -t switchyard`) and switch between them with `prefix n`/`prefix p`, or `prefix w` to pick from a list.

The session shows up on the Agents page within seconds. Jump, Reply and Stop reach it through tmux, wherever it's attached. Install tmux (`brew install tmux`) and restart switchyard to get the button. Claude Code trusts a worktree when you have trusted its main checkout, so the new session starts without a trust prompt.

New tabs go into the front iTerm window. If iTerm has no windows, a new window opens; if it isn't running, it launches and uses the window it opens. Terminal.app always opens a new window, because it has no scriptable "new tab".

### Answering permission prompts from the page

Claude Code sends each permission prompt to a `PermissionRequest` hook while also showing it in the terminal. Add switchyard's hook to `~/.claude/settings.json` once:

```sh
npm run hook -- install   # or: remove, status
```

Running sessions pick it up without a restart. The hook waits up to an hour for an answer from the page; the terminal prompt works throughout. When switchyard isn't running, the hook can't connect and Claude Code simply shows its usual prompt. Questions Claude asks you (`AskUserQuestion`) stay in the terminal.

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
- **The pace follows who's watching.** It runs at full speed while the pull requests or Worktrees page is open, 3× slower while only a header badge on another page is asking, and stops entirely when no page is open. Opening the page again refreshes anything that went stale.
- **Updates are pushed, not polled.** The PR page holds a server-sent events stream (`/api/prs/stream`) and redraws when the server has new data. Each PR shows when it was last checked, and the header shows **Live · GitHub checked 12s ago**. The page closes the stream while its tab is hidden, and falls back to polling once a minute if the stream drops.
- **Each page refreshes at its own pace.** The Agents page polls a sessions-only feed every **4s** (no `git status`, no GitHub). The Worktrees page polls the full board every **5s**. Header badges for the page you're on come with that page's data; the other pages' badges catch up once a minute.
- **`git status` only runs where something changed.** Every worktree is watched with a recursive `fs.watch` (FSEvents on macOS). A worktree is rescanned when a file in it changes, when its own index or `HEAD` changes, or when the repo's refs or config change (which can move ahead/behind counts), and at least every 5 minutes regardless. Other writes under `.git` (objects, logs, locks, Watchman cookies) are ignored.
- **The Worktrees page asks GitHub as little as possible.** One batched GraphQL query finds the PRs for every checked-out branch. Checks, merge state and review decisions for your own PRs come from the PR sync above; only PRs it doesn't track (someone else's branch) are fetched one by one. Asking for `statusCheckRollup` across many PRs makes GitHub's GraphQL API time out, so checks are never batched.
- Board data sits behind a stale-while-revalidate cache, so the page answers immediately and refreshes in the background. **Refresh** forces a rescan and a fresh branch lookup; your PRs' checks still come from the PR sync.
- Transcript summaries are memoized by file size, since transcripts are append-only.

## Security

The server binds to `127.0.0.1` and rejects requests whose `Host` header isn't `localhost`/`127.0.0.1`, which blocks DNS rebinding. Responses carry a strict CSP. The API exposes local paths and your prompts, so don't proxy it anywhere.

The action endpoints (`POST /api/prs/copilot-review`, `/api/approvals/decide`, `/api/tasks/new` and `/api/terminal/*`) also require an `Origin` matching the dashboard and an `application/json` body, so other websites open in your browser can't trigger it. They only act on things the server itself discovered. The browser names a PR, a session ID or a worktree path, never a command. The server builds every command from a fixed template, passes values to AppleScript as arguments rather than splicing them into the script, and refuses multi-line commands. New task only works in repositories switchyard discovered, checks the branch name with `git check-ref-format`, and passes it, the folder and the task to git and tmux as separate arguments; the task is shell-quoted where it's typed after `claude`. A reply is typed as plain text, and control characters such as Return or Esc are refused so it can't act as keystrokes. It still reaches Claude Code exactly as if you'd typed it, including `/` commands and `!` shell commands, so the Origin check is what keeps other sites from sending one.

The live terminal is a keyboard on the session, so it gets more checks. Opening one (`GET /api/terminal/live`, a server-sent event stream) is refused when the browser marks the request as coming from another site, and another site couldn't read the stream anyway. Opening it hands out a random token, and typing (`POST /api/terminal/input`), resizing and acknowledging drawn output need that token as well as the Origin check. It only opens panes switchyard found running a Claude session it knows. The server follows the pane through tmux control mode (`tmux -C`), the same interface iTerm2's tmux integration uses, so no extra process or pty is involved. The Agents page's CSP allows `<style>` elements only with a nonce made fresh for each page load, which the page gives to the one style element xterm.js creates. That's also why the terminal draws with WebGL: xterm.js's default renderer colours cells with `style` attributes, which no nonce can allow.

The hook endpoint (`POST /hooks/permission-request`) is called by Claude Code, not the page. It refuses any request carrying an `Origin` header, which browsers always send, so a website can't reach it. A local program could post a fake request, but that only adds a row to the page; answering it affects nothing. The hook trusts whatever answers on its port. If switchyard isn't running, another program could take that port and approve prompts. Any program running as you could already do worse, so this only matters on a Mac shared with other accounts. There, use `npm run hook -- remove` while switchyard is off.
