# switchyard

[![Tests](https://github.com/lokiwins/switchyard/actions/workflows/test.yml/badge.svg)](https://github.com/lokiwins/switchyard/actions/workflows/test.yml)

A local status board for parallel development: your running AI agent sessions, your git worktrees, and your pull requests, side by side.

```bash
npm start          # http://localhost:4477
npm test
```

Requires Node 22+, `git`, and an authenticated `gh` CLI. There are no npm dependencies.

## What it shows

Four pages share a header nav. Each nav link carries a badge counting what needs you there: **Agents** shows sessions waiting on you plus recent interruptions (amber), and **Pull requests** shows PRs needing fixes (red) or review requests (purple).

### Agents page (`/`, the landing page)

- **Running:** every live Claude Code session, read from `~/.claude/sessions/*.json`. A session counts as running only if its process is alive *and* started when the registry says it did, so a reused process ID can't make a dead session look alive. *Working* and *waiting* sessions come first. *Parked* sessions (idle over a day) collapse behind a toggle.
- **Recently ended:** sessions from the last 7 days that are no longer running, labelled by how their last turn ended:
  - *Interrupted*: the terminal closed mid-turn (an unanswered prompt, a tool call with no result, or a tool result never continued from)
  - *Stopped* (Esc), *Exited* (`/exit`), or *Finished*

  Interruptions from the last 3 days are highlighted and flag their worktree. Sessions that never received a prompt are hidden.
- **Filters and search:** tiles and a segmented control for All / Working / Waiting / Interrupted / Parked / Ended, plus search across name, repo, branch, folder and prompt. Click a prompt to expand it in place.
- Each row has `cd` and resume (`cd <dir> && claude --resume <id>`) copy buttons, plus a link to the worktree's PR when there is one.
- **Graph** opens the session's context graph (`/graph?session=<id>`) in a graph tab, built from its transcript and its subagents' transcripts. Your prompts form a chain from the session, and each links to what it brought into Claude's context: files read, edited or written, tools (each MCP server is one node), CLAUDE.md, rules and memory files loaded, skills, and subagents, each with the files and tools it used. Compactions sit in the chain, and whatever was last used before the latest one is faded, since it's no longer in context. A node's size is the tokens it put into the main conversation's context, estimated at about 4 characters a token; what a subagent reads stays in the subagent's context, so only its call and answer count. **In context now** gives the context size Claude reported on its last call, with a bar and a list of what fills it by kind. Whatever the estimates don't cover (the system prompt, tool definitions, reminders) is listed as Other. It updates live while the session runs. Tick kinds on or off, find a node by name, and click one to see its full path or prompt and its connections. Every Graph button uses the same graph tab, so another session's graph replaces the one shown instead of opening a tab of its own; **Close** closes it (or, for a graph opened by its address, goes back to Agents). It's drawn with [Cytoscape.js](https://js.cytoscape.org/), vendored in `public/vendor/cytoscape`.

### Worktrees page (`/worktrees`)

- Every repository under your roots, grouped by repository. Each worktree shows:
  - uncommitted, untracked and conflicted files, and whether it is ahead of or behind upstream
  - the matching PR (open, draft, merged or closed), its checks, review decision and merge conflicts
  - the agents running in it, or its most recent past session
- **Views:** *Active*, *Needs attention* (failing checks, changes requested, merge conflict, git conflicts, an agent waiting or recently interrupted), *Agents*, *Clean up* (PR merged or closed, worktree clean, no agent), and *All*. Each row in *Clean up* has a **Clean up ▾** menu that says what it will do and removes the worktree when you press Remove: `git worktree remove` (never `--force`), plus `git branch -D` for the branch when its PR was merged (a squash merge leaves the branch "unmerged" to git). A closed, unmerged PR keeps its branch. Before removing anything, switchyard checks again rather than trusting the page: no Claude session running in the worktree, no uncommitted or untracked files, and no commits that aren't in the PR (its branch tip is the PR's last commit or behind it) or on a remote. The menu also has the commands to copy, if you'd rather run them yourself.
- **My open PRs without a local worktree.**

### Pull requests page (`/prs`)

- **My pull requests** and **review requested from you** (direct requests), sorted most urgent first. Each PR has one headline status: merge conflict, checks failing, changes requested, ready to merge, approved but blocked, behind base, checks running, awaiting review, or draft.
- **Checks:** passed, failed and running counts, with the failing checks named and linked. Superseded re-runs are ignored. CI workflows waiting on a manual approval job (CircleCI `hold`/`Approve …`) count as *awaiting manual approval* rather than running, including the jobs queued behind the hold.
- **Reviews:** each reviewer's latest verdict, plus outstanding user and team requests.
- **Local:** the worktree where the branch is checked out, any agents working in it, and a `cd` command. If it isn't checked out, a `gh pr checkout` command instead.
- **Copilot review button** on your own PRs: *Request* / *Re-request Copilot review* (the tooltip shows when Copilot last reviewed). It calls `POST repos/{repo}/pulls/{n}/requested_reviewers` with `copilot-pull-request-reviewer[bot]` through `gh api`. While a request is outstanding, the button is disabled.
- **Requested from your teams:** a lighter, collapsible list of PRs waiting on a team you're in.

### Tasks page (`/tasks`)

A hub for the work you're tracking, and for picking what to do next. The tasks are switchyard's own, not a tracker's: you add them, and each can link to its tickets wherever they live.

- **Add a task** with a title and, optionally, a due date, notes (what Claude will be told when you start it) and links to its tickets: ClickUp, GitHub, Jira, Azure DevOps or any other URL. Links are shown as a badge by tracker and number, like *ClickUp 86b4fx1* or *GitHub #42*. Tasks are kept in `~/.config/switchyard/tasks.json` (or under `$XDG_CONFIG_HOME`), readable only by you.
- **Where each task stands** comes from its work, so there's nothing to keep up to date by hand: *Not started*, *Working* (Claude is busy), *Needs you* (Claude is asking something or waiting for your next message), *In review* (its PR is open), *Paused* (a worktree with nothing running and no PR) and *Done* (its PR merged). Use **⋯ › Mark done** or **Drop** when there's no PR to say so, **Reopen** to undo either, and **Delete** to remove a task (its worktree, branch and tickets are left alone).
- **Start ▾** on a task that hasn't started (needs tmux) runs New task on it: pick the repo, and Claude starts in a new worktree beside it, told the task's title, notes and ticket links. The branch names the task, so its work shows under it: `CU-<id>-…` when it links a ClickUp ticket (which ClickUp's GitHub integration reads too), or the task's own `sy-…` id otherwise. The row says *Starting…* at once; if Claude asks whether to trust the folder, the row asks too (**Trust folder** / **Don't trust**), and if Claude quits before starting it says why. A running session's controls are on its line under the task, as on the Agents page: Allow/Deny, Plan, Answer, Reply, Stop, Terminal and Jump.
- **A task's details:** click its title to open it in a pane over the right of the page. Edit its title, due day, notes and links, and **Save** (Esc closes without saving). Each linked ticket shows there too: a ClickUp ticket's name, status and description from ClickUp, with **Status ▾** to move it to another of its list's statuses; a GitHub issue or PR's title, state and body through `gh`, and an issue's **Status ▾** to close or reopen it (a PR is merged or closed on GitHub). Jira, Azure DevOps and other links are offered to open, not read.
- **What needs you comes first**, then the rest by when they're due: *Overdue*, *Today*, *This week*, *Later* and *No date*. *Done* is folded away at the bottom. A filter box searches title, id, notes, links and branches.
- **The work on each task.** A worktree whose branch contains the task's id (like `sy-k3x9q2-receipts`), or the id of a ClickUp ticket it links to (`CU-86b4fx1-invoice-pdf`, the bare id, or a custom id like `ENG-123`), or that was saved on it by **Make task**, shows under it: its repo and branch, its pull request, and **Terminal** and **Jump** to its Claude session, or **Open ▾** to start or resume one there.
- **Make a task from work already under way.** **Make task** on a session's row on the Agents page (running or recently ended), or on a worktree on the Worktrees page, opens the task form filled in from the session: its title and the first thing you asked. Change anything, then **Add task**. The task is linked to that work without renaming anything: its repo and branch are saved on it, so the worktree, its PR and its sessions show under the task, and it's *Done* when the PR merges. A session on a long-lived branch like `main` is saved by itself instead, so the task doesn't take in everything else done on main. Work that already has a task shows **Task** instead, which opens it here.
- **Add from ▾** makes tasks from the open tickets assigned to you in your trackers, a tab each (it opens on the one you used last). It lists those no task links yet, with their status, id and where they live; click one to make a task of it (its name, link and due day). It leaves the list, which stays open for the next. A filter box narrows it.
  - **ClickUp:** your open tickets in the chosen workspace.
  - **GitHub:** the open issues assigned to you, through your `gh` login (`gh search issues --assignee=@me`).
  - Linear, Jira and Azure DevOps are coming soon.
- **Connections ▾** in the header shows which trackers are connected, with a card each. **ClickUp** connects with a personal API token: in ClickUp, open **Settings › Apps** and generate one (it starts with `pk_`), then paste it there. switchyard checks it with ClickUp before keeping it, in `~/.config/switchyard/task-tools.json`, readable only by you. **Disconnect** deletes it. If the token can see several workspaces, pick one there. **GitHub** uses your GitHub CLI login: if it says to, run `gh auth login`, then Refresh. On the Agents page, a session on a branch naming a ClickUp task links back to it.

## Acting from the dashboard (macOS)

A web page can't touch your terminal, but the switchyard server runs on your machine, so the buttons ask it to. What each one can do depends on where the session runs:

| | iTerm | Terminal | VS Code, Cursor, Windsurf | Inside tmux, in any of these |
|---|---|---|---|---|
| Listed on the Agents page, with its status | ✓ | ✓ | ✓ | ✓ |
| **Allow / Deny** a permission prompt (needs the hook) | ✓ | ✓ | ✓ | ✓ |
| **Jump** | the exact tab | the exact tab | the folder's window | the task's own tab |
| **Reply ▾** | ✓ | – | – | ✓ |
| What a waiting session asks | ✓ | ✓ | – | ✓ |
| **Answer ▾** | ✓ | – | – | ✓ |
| **Plan** | ✓ | to read | – | ✓ |
| **Stop** | – | – | – | ✓ |
| **Terminal** (the live pane) | – | – | – | ✓ |

A session running inside tmux is recognised by its tmux pane, whichever app tmux itself runs in, so starting Claude in tmux gives every control. Sessions started with **New task** always run in tmux. The gaps are where switchyard can't get at the terminal from outside: Terminal can be read but only sent keys by bringing its tab to the front, and an editor's built-in terminal can't be read or typed into at all. A session waiting on you there says so on its row: where to answer it, and that running Claude in tmux would let you answer from the page. **Resume** works for an ended session from any of them. With tmux installed it opens in a window of the `switchyard` tmux session; without tmux it opens a new tab in the terminal the session ran in, or in your configured terminal.

- **Jump** (running sessions) gets you to the session as precisely as its host app allows. switchyard finds the host by walking up the session's parent processes:
  - **iTerm / Terminal**: selects the exact tab running the session.
  - **tmux**: selects the tab already showing the task, or opens the task in a new tab of its own. That tab shows just the task's window, through a small tmux session named `switchyard-view-<n>` that holds only it, and is titled after the window. Closing the tab leaves the task running, and the next Jump opens it again. When the task's window closes, its tab closes too.
  - **VS Code, Cursor, Windsurf**: brings forward the window for the session's folder. You pick the terminal there.
  - **Other apps** (e.g. Codex in the ChatGPT app): brings the app to the front.

  If the session's tab was closed, Jump resumes it instead (see Resume).
- **What a waiting session asks** (sessions in tmux or iTerm): when a session is waiting on you, its row shows the question and its options as Claude Code draws them in the terminal: a question Claude asks you, a plan to approve, or a permission prompt. Click it to see the whole dialog, descriptions included. It's read off the session's screen, because these aren't in the transcript until they're answered: with `tmux capture-pane` for a tmux pane, and through iTerm's or Terminal's scripting for their tabs, without bringing them forward. A Terminal session's dialog is shown but can't be answered from the page, and its **Plan** opens to read only. Editor terminals (VS Code, Cursor) can't be read this way. Answer it here with **Answer ▾**, in the terminal, or with **Terminal** below.
- **Answer ▾** (sessions in tmux or iTerm) lists the dialog's options. Picking one presses its number in the session's terminal, after switchyard reads the screen again to check it still shows that question and option, since the same number would answer something else. Options that open a text field ("Type something.", "Tell Claude what to change") take your text from the menu. A multiple-choice question's options tick boxes, and **Next →** goes on to the next tab of a question in several parts, until its last tab, where you submit. A permission prompt that offers *Tab to amend* also has a box under its Yes and its No for an instruction to send along ("Yes, and run the tests"), as Tab does in the terminal: switchyard moves the selection there with the arrow keys, presses Tab, and types it, checking the screen after each step. An iTerm tab gets the same keys through iTerm's scripting, after switchyard checks the session still runs in that tab. For a permission prompt the approvals hook has already sent, use Allow / Deny instead.
- **Plan** (plan approvals in tmux, iTerm or Terminal) opens the plan in the glass pane, rendered from the Markdown file the dialog names in `~/.claude/plans`, with the dialog's options to answer it there (in Terminal, to read only).
- **Review / Allow / Deny** appear on a session waiting on a permission prompt, showing what Claude wants to run or touch. **Review** opens it in full in the glass pane (see below). Allow runs it once. Deny stops Claude to wait for you, like "No" in the terminal. The terminal's own prompt stays open the whole time, and whichever you answer first wins. This needs a one-time hook (see below).
- **Reply ▾** (sessions in tmux or iTerm) types a one-line message into the session and presses Return, as if you'd typed it there. A message sent while Claude is working is queued until its current step finishes. It's refused while a question or prompt is open, because the text would answer it. It lands after anything already typed in its input box. tmux sessions get it through `tmux send-keys`, so they don't need to be attached or have a tab.
- **Stop** (working sessions in tmux) presses Esc in the session, ending Claude's current turn as it would in the terminal.
- **Terminal** (sessions in tmux) opens the session live in a pane over the right half of the page. You see exactly what its terminal shows and can type into it: keys, Esc, arrows, menus and pastes all reach Claude as if you were attached. Drag the pane's left edge to make it wider or narrower (or focus the edge and use ← and →, with Shift for bigger steps; double-click goes back to half the page). The width is remembered in this browser. The tmux window takes the pane's size, and follows when you resize the pane or the browser. If a terminal tab attached to the same session takes the size back, the pane follows that instead. If the page falls behind a flood of output (or sits in a background tab), switchyard pauses the pane in tmux once about 512 KB is waiting, and redraws it from tmux's copy of the screen when the page catches up, so nothing is missing and typing stays responsive. If the connection drops, for example when switchyard restarts, the pane reconnects by itself and redraws; if the session has ended it says so and offers Reconnect. Closing the pane leaves the session running. It draws with [xterm.js](https://xtermjs.org) (vendored in `public/vendor/xterm`, loaded only when you open one) and needs WebGL.
- **Resume** (ended sessions) brings the conversation back with `claude --resume <id>` in its folder. With tmux installed, it opens as a new tab of the `switchyard` tmux session, named after the folder (`-2`, `-3`… if taken), so the resumed session gets Terminal, Stop and Reply like a new task. Without tmux, it opens a new tab in your terminal app. The same goes for resuming from a worktree's **Open ▾** menu, and for Jump on a session that has closed. A session whose folder is gone (e.g. a removed worktree) isn't resumed.
- **Terminal** (worktrees, PRs) opens a new tab in that folder.
- **Code** opens the folder in your editor.
- **⧉** buttons copy the command instead, for anywhere else.

### New task (needs tmux)

**New task ▾** on the Agents page starts Claude on a task, in its own worktree on its own branch. You say what the task is; the branch is optional:

1. Picks the branch. Left empty, it's named after the task: its first few meaningful words, lowercase and hyphenated ("Fix the login redirect on the settings page" becomes `fix-login-redirect-settings-page`), with `-2`, `-3`… added if a branch, folder or tab of that name already exists, so it's always a new branch. The form shows the name as you type.
2. Creates the worktree beside the repo as `<repo>-<last branch segment>` (`fix/login` in `my-repo` becomes `my-repo-login`). A branch you name that exists locally is checked out. A branch that only exists on origin is checked out tracking it. Otherwise a new branch starts from origin's default branch, fetched first, without tracking it, so a push can't land on main. If tmux fails to start the window, the new worktree is removed again so you can retry.
3. Opens a window (tab) of the same name in the `switchyard` tmux session, starting the session if it isn't running, and types `claude` in it with your task as the first prompt. The window opens in the background, so if you're attached you stay where you are. Its shell starts from the same PATH as a new terminal tab, so `claude` there is the one your terminal runs, even when switchyard itself runs under a Node version manager. Every task is a window in that one session, running in the background: **Jump** opens a task in an iTerm (or Terminal) tab of its own. Or attach the whole session yourself (`tmux attach -t switchyard`) and switch between tasks with `prefix n`/`prefix p`, or `prefix w` to pick from a list.

The task shows on the Agents page as soon as you press Start (*Creating…*, then *Starting…*), and becomes its session once Claude is running, usually within seconds. Jump, Reply and Stop reach it through tmux, wherever it's attached. Install tmux (`brew install tmux`) and restart switchyard to get the button. Claude Code trusts a worktree when you have trusted its main checkout, so usually there's no trust prompt. When there is (a repo Claude hasn't been trusted in yet), the row asks too, with **Trust folder** and **Don't trust**. If Claude quits before starting, or isn't installed, the row says so at once and shows what the shell said. The worktree is kept either way.

New tabs go into the front iTerm window. If iTerm has no windows, a new window opens; if it isn't running, it launches and uses the window it opens. Terminal.app always opens a new window, because it has no scriptable "new tab".

### Answering permission prompts from the page

Claude Code sends each permission prompt to a `PermissionRequest` hook while also showing it in the terminal. Add switchyard's hook to `~/.claude/settings.json` once:

```sh
npm run hook -- install   # or: remove, status
```

**Review** shows a prompt in full before you answer it, in the glass pane:

- **Edit** and **MultiEdit**: the diff the edit would make to the file as it is now, with a few lines of context and line numbers, like `git diff`. If the text to replace is no longer in the file, or the file can't be read, it shows just the old and new text and says why.
- **Write**: the diff against the existing file, or the whole new file. Markdown files also get a **Rendered** view: headings, lists, task lists, tables, code blocks and links.
- **Bash**: the whole command, however long. Anything else: the tool's input.

From the pane you can Allow, or Deny with an optional reason. A bare Deny stops Claude to wait for you; a reason lets it adjust and try again. Esc or Close leaves the prompt waiting.

Running sessions pick it up without a restart. The hook waits up to an hour for an answer from the page; the terminal prompt works throughout. When switchyard isn't running, the hook can't connect and Claude Code simply shows its usual prompt. Questions Claude asks you (`AskUserQuestion`) and plans waiting for approval (`ExitPlanMode`) stay in the terminal, because allowing them would skip your answer or your choice of how the plan goes ahead; in tmux or iTerm you can still answer them from the page with **Answer ▾** and **Plan**.

The first time you use these, macOS asks whether to let switchyard's terminal control iTerm or Terminal (System Settings → Privacy & Security → Automation).

## Configuration

Everything works without a config file. The **Settings** page (in the top bar) changes most options and saves them to `config.json`; they apply at once, without a restart. Only `port` and `claudeDir` need editing by hand and a restart. To adjust the file directly, copy `config.example.json` to `config.json`. That file is gitignored, so workplace-specific values (your CI's job names, your team's branches) stay local. Unknown keys and invalid values stop the server at startup with a message naming the key.

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
- **Sessions are pushed as they change.** Claude Code rewrites its session registry (`~/.claude/sessions/`) the moment a session starts, ends or changes status, so switchyard watches that folder and pushes the Agents page's data over a server-sent events stream (`/api/agents/stream`), usually within a quarter of a second. A permission prompt arriving or going is pushed the same way. The page closes the stream while its tab is hidden and catches up when you return; it also checks in every **15s** in case an update was missed, and polls every **4s** if the stream drops.
- **The Worktrees page polls** the full board every **5s**. Header badges for the page you're on come with that page's data; the other pages' badges catch up once a minute.
- **`git status` only runs where something changed.** Every worktree is watched with a recursive `fs.watch` (FSEvents on macOS). A worktree is rescanned when a file in it changes, when its own index or `HEAD` changes, or when the repo's refs or config change (which can move ahead/behind counts), and at least every 5 minutes regardless. Other writes under `.git` (objects, logs, locks, Watchman cookies) are ignored.
- **The Worktrees page asks GitHub as little as possible.** One batched GraphQL query finds the PRs for every checked-out branch. Checks, merge state and review decisions for your own PRs come from the PR sync above; only PRs it doesn't track (someone else's branch) are fetched one by one. Asking for `statusCheckRollup` across many PRs makes GitHub's GraphQL API time out, so checks are never batched.
- Board data sits behind a stale-while-revalidate cache, so the page answers immediately and refreshes in the background. **Refresh** forces a rescan and a fresh branch lookup; your PRs' checks still come from the PR sync.
- Transcript summaries are memoized by file size, since transcripts are append-only.

## Security

The server binds to `127.0.0.1` and rejects requests whose `Host` header isn't `localhost`/`127.0.0.1`, which blocks DNS rebinding. Responses carry a strict CSP. The API exposes local paths and your prompts, so don't proxy it anywhere.

The action endpoints (`POST /api/prs/copilot-review`, `/api/approvals/decide`, `/api/tasks/new`, `/api/tasks/trust`, `/api/hub/tasks/*` (Start included), `/api/hub/ticket/status`, `/api/task-tools/*` and `/api/terminal/*`) also require an `Origin` matching the dashboard and an `application/json` body, so other websites open in your browser can't trigger it. They only act on things the server itself discovered. The browser names a PR, a session ID or a worktree path, never a command. The server builds every command from a fixed template, passes values to AppleScript as arguments rather than splicing them into the script, and refuses multi-line commands. New task only works in repositories switchyard discovered, checks the branch name with `git check-ref-format`, and passes it, the folder and the task to git and tmux as separate arguments; the task is shell-quoted where it's typed after `claude`. Trust folder only answers in a tmux pane New task opened, only while Claude is asking whether to trust the folder there, and only with arrow keys and Enter. A reply is typed as plain text, and control characters such as Return or Esc are refused so it can't act as keystrokes. It still reaches Claude Code exactly as if you'd typed it, including `/` commands and `!` shell commands, so the Origin check is what keeps other sites from sending one.

The live terminal is a keyboard on the session, so it gets more checks. Opening one (`GET /api/terminal/live`, a server-sent event stream) is refused when the browser marks the request as coming from another site, and another site couldn't read the stream anyway. Opening it hands out a random token, and typing (`POST /api/terminal/input`), resizing and acknowledging drawn output need that token as well as the Origin check. It only opens panes switchyard found running a Claude session it knows. The server follows the pane through tmux control mode (`tmux -C`), the same interface iTerm2's tmux integration uses, so no extra process or pty is involved. The Agents page's CSP allows `<style>` elements only with a nonce made fresh for each page load, which the page gives to the one style element xterm.js creates. That's also why the terminal draws with WebGL: xterm.js's default renderer colours cells with `style` attributes, which no nonce can allow.

The ClickUp token is kept in a file only you can read, outside the checkout, and is only ever sent to ClickUp, by the server. The page is told who you are and which workspace it shows, never the token. Connecting, disconnecting and choosing a workspace (`POST /api/task-tools/*`) need the same `Origin` and JSON body as the other actions, and a workspace must be one the token can see. A task's ticket links are only ever read from ClickUp's API (by a task id or custom id that's checked first) or with `gh` (by an owner, repo and number that are checked, so a link can't pass gh an option); a link never makes switchyard request a URL of its own choosing. A ClickUp status can only be changed to one of the ticket's list's statuses.

Review reads the file an Edit or Write would change, only to show the diff: a regular text file of at most 1 MB at an absolute path, nothing else. The diff comes from `GET /api/approvals/detail`, which another site's page can't read, and only for a prompt that is waiting. The rendered Markdown is built element by element, never as HTML, so a file can't run script or load anything; links open only for `http`, `https` and `mailto`, and images show their alt text.

The hook endpoint (`POST /hooks/permission-request`) is called by Claude Code, not the page. It refuses any request carrying an `Origin` header, which browsers always send, so a website can't reach it. A local program could post a fake request, but that only adds a row to the page; answering it affects nothing. The hook trusts whatever answers on its port. If switchyard isn't running, another program could take that port and approve prompts. Any program running as you could already do worse, so this only matters on a Mac shared with other accounts. There, use `npm run hook -- remove` while switchyard is off.

## Releases and screenshots

Releases come from the commit messages. PRs are squash-merged with [Conventional Commit](https://www.conventionalcommits.org) titles (`feat: …`, `fix: …`, `perf: …`), and [release-please](https://github.com/googleapis/release-please) keeps a release PR open that bumps `package.json` and adds those titles to `CHANGELOG.md`. Merging the release PR tags the version (`v0.2.0`) and publishes a GitHub release with the same notes. Before 1.0, `feat` bumps the minor version and `fix` the patch; a breaking change (`feat!:`) also bumps only the minor.

Screenshots come from switchyard itself, run against made-up data: `scripts/screenshots` builds a throwaway home with two repos (`acme/storefront`, `acme/billing-api`), their worktrees, Claude sessions in them and a stand-in `gh` with their PRs, so nothing of yours (and no network) is involved. Each **scene** in `scripts/screenshots/scenes.mjs` opens a page and gets it into a state worth showing, such as New task open or a permission prompt in the Review pane.

- **On a PR** that touches `public/`, `src/` or the screenshot scripts, the Screenshots workflow captures every scene at the PR's merge base and at its head, compares them pixel by pixel, and comments with before and after images of the scenes that look different. If `public/` changed but no scene does, the comment asks for one.
- **On a release**, the same comparison runs against the previous release, and the scenes that are new or look different are attached to the release as `screenshot-<scene>.png` and shown in its notes under *Screenshots*.

PR preview images are stored on the `screenshots` branch, which only exists for those comments: delete it whenever you like, and older comments lose their pictures. When a change adds or reworks something on screen, add or update a scene. To capture locally (from a worktree without a `config.json`, which would show your own data):

```bash
cd scripts/screenshots
npm ci && npx playwright install --only-shell chromium
node capture.mjs --out /tmp/shots base=../../../switchyard-main head=../..
node compare.mjs --base /tmp/shots/base --head /tmp/shots/head --out /tmp/shots/report.json
```
