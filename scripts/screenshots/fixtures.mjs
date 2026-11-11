/*
 * Builds the world in fixture-data.mjs on disk under a throwaway HOME: git
 * repos with worktrees under ~/code, Claude Code's session registry and
 * transcripts under ~/.claude, a `gh` stub on PATH, and a sleeping process
 * standing in for each running session. switchyard then runs against it
 * unchanged, with no network and none of your own data.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLICKUP, ISSUES, PLAN, PLAN_FILE, REPOS, SESSIONS, VIEWER, hubTasks, pullRequests,
} from './fixture-data.mjs';
import { startFakeClickUp } from './fake-clickup.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = '/hooks/permission-request';
const minutes = (n) => n * 60_000;
// The tmux session the dialog sessions run in, named as New task names its own.
const TMUX_SESSION = 'switchyard';
const PANE_SIZE = ['-x', '110', '-y', '32'];

function writeFiles(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

function makeGit(env) {
  return (cwd, args, date) => execFileSync('git', [
    '-c', 'user.name=dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd, env: date ? { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : env, encoding: 'utf8' }).trim();
}

/** Each repo with its worktrees; returns branch -> tip commit, for the PRs' headRefOid. */
function buildRepos(code, git, now) {
  const tips = new Map();
  const sessionFiles = (folder) => Object.assign({}, ...SESSIONS.filter((s) => s.worktree === folder).map((s) => s.files ?? {}));
  for (const repo of REPOS) {
    const main = join(code, repo.name);
    mkdirSync(main, { recursive: true });
    writeFiles(main, repo.files);
    git(main, ['init', '-q', '-b', 'main']);
    git(main, ['remote', 'add', 'origin', `https://github.com/${repo.github}.git`]);
    git(main, ['add', '-A']);
    git(main, ['commit', '-q', '-m', 'Initial commit'], new Date(now - minutes(60 * 24 * 10)).toISOString());
    for (const wt of repo.worktrees) {
      const path = join(code, `${repo.name}-${wt.suffix}`);
      git(main, ['worktree', 'add', '-q', '-b', wt.branch, path]);
      writeFiles(path, { [`notes/${wt.suffix}.md`]: `# ${wt.branch}\n`, ...sessionFiles(`${repo.name}-${wt.suffix}`) });
      git(path, ['add', '-A']);
      git(path, ['commit', '-q', '-m', `Work on ${wt.branch}`], new Date(now - minutes(wt.commitMinutesAgo)).toISOString());
      tips.set(`${repo.github}#${wt.branch}`, git(path, ['rev-parse', 'HEAD']));
      if (wt.dirty) writeFiles(path, { 'src/auth/redirect.js': 'export const AFTER_LOGIN = next;\n' });
    }
  }
  return tips;
}

/** Transcript lines for a session's turns, the last one `minutesAgo` before now. */
function transcriptLines(session, { sessionId, cwd, branch, now }) {
  const at = (i) => new Date(now - minutes(session.minutesAgo) - (session.turns.length - 1 - i) * 30_000).toISOString();
  const common = (i) => ({ sessionId, cwd, gitBranch: branch, timestamp: at(i), uuid: randomUUID() });
  const lines = session.turns.map((turn, i) => {
    if (turn.prompt) return { type: 'user', ...common(i), message: { role: 'user', content: turn.prompt } };
    const tool = turn.tool && { type: 'tool_use', id: `toolu_${i}`, name: turn.tool.name, input: { ...turn.tool.input, file_path: join(cwd, turn.tool.input.file_path) } };
    return { type: 'assistant', ...common(i), message: { role: 'assistant', content: [{ type: 'text', text: turn.reply }, ...(tool ? [tool] : [])] } };
  });
  return [{ type: 'ai-title', sessionId, aiTitle: session.title }, ...lines];
}

function folderOf(code, worktree) {
  const repo = REPOS.find((r) => worktree === r.name || worktree.startsWith(`${r.name}-`));
  const wt = repo.worktrees.find((w) => worktree === `${repo.name}-${w.suffix}`);
  return { cwd: join(code, worktree), branch: wt?.branch ?? 'main' };
}

/**
 * A stand-in for a session that runs in a window of the fixtures' own tmux
 * server, showing `screen`. Its pid is the pane's, so switchyard finds the
 * session's pane by its tty, as it does a real one's. Returns the pid.
 */
function startInTmux({ env, root, name, cwd, screen }) {
  const file = join(root, `${name}.screen`);
  writeFileSync(file, screen.join('\n'));
  const command = `cat '${file}'; exec sleep 86400`;
  const tmux = (args) => execFileSync('tmux', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const format = ['-P', '-F', '#{pane_pid}'];
  let started;
  try {
    started = tmux(['new-window', '-d', '-t', `=${TMUX_SESSION}:`, '-n', name, '-c', cwd, ...format, command]);
  } catch {
    started = tmux(['new-session', '-d', '-s', TMUX_SESSION, '-n', name, '-c', cwd, ...PANE_SIZE, ...format, command]);
  }
  return Number(started);
}

function startDetached() {
  const child = spawn('sleep', ['86400'], { detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

/** Writes transcripts and registry entries; returns running pids and hook payloads. */
function buildSessions({ code, claudeDir, now, env, root }) {
  const pids = [];
  const approvals = [];
  for (const session of SESSIONS) {
    const sessionId = randomUUID();
    const { cwd, branch } = folderOf(code, session.worktree);
    const dir = join(claudeDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    const file = join(dir, `${sessionId}.jsonl`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${transcriptLines(session, { sessionId, cwd, branch, now }).map((l) => JSON.stringify(l)).join('\n')}\n`);
    const lastAt = new Date(now - minutes(session.minutesAgo));
    utimesSync(file, lastAt, lastAt);
    if (!session.status) continue;

    const pid = session.screen
      ? startInTmux({ env, root, name: session.worktree, cwd, screen: session.screen })
      : startDetached();
    pids.push(pid);
    writeFileSync(join(claudeDir, 'sessions', `${pid}.json`), JSON.stringify({
      pid, sessionId, cwd, kind: 'interactive', status: session.status, nameSource: 'derived',
      startedAt: now - minutes(session.minutesAgo + 20), statusUpdatedAt: lastAt.getTime(),
    }));
    if (session.approval) {
      const { tool_name, file: path, ...edit } = session.approval;
      approvals.push({
        hook_event_name: 'PermissionRequest', session_id: sessionId, cwd, permission_mode: 'default',
        transcript_path: file, tool_name, tool_input: { file_path: join(cwd, path), ...edit },
      });
    }
  }
  return { pids, approvals };
}

/** A `gh` on PATH that answers from the fixture PRs. */
function installFakeGh(root, tips, now) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const prs = pullRequests(now).map((pr) => ({ ...pr, headRefOid: tips.get(`${pr.repository.nameWithOwner}#${pr.headRefName}`) ?? '0'.repeat(40) }));
  const fixture = join(root, 'gh-fixture.json');
  writeFileSync(fixture, JSON.stringify({ viewer: VIEWER, prs, issues: ISSUES }));
  const script = join(bin, 'gh');
  writeFileSync(script, `#!/bin/sh\nexec "${process.execPath}" "${join(HERE, 'fake-gh.mjs')}" "$@"\n`);
  chmodSync(script, 0o755);
  return { bin, fixture };
}

/**
 * Lays out the fixture world for a server on `port`: HOME at `home` (default
 * <root>/home), everything else under `root`. The page shows paths under
 * /Users/<name> or /home/<name> as ~/…, so CI passes a home like /home/dev.
 * @returns {{ env: NodeJS.ProcessEnv, approvals: object[], stop: () => void }}
 */
export function buildFixtures({ root: tempRoot, home: homeDir, port, now }) {
  // Real paths, as git reports them (macOS's /var is a link to /private/var), so sessions match worktrees.
  const root = realpathSync(tempRoot);
  const home = homeDir ?? join(root, 'home');
  mkdirSync(home, { recursive: true });
  const code = join(home, 'code');
  const claudeDir = join(home, '.claude');
  mkdirSync(join(claudeDir, 'sessions'), { recursive: true });
  mkdirSync(join(claudeDir, 'plans'), { recursive: true });
  writeFileSync(join(claudeDir, 'plans', PLAN_FILE), PLAN);
  mkdirSync(code, { recursive: true });
  // The approvals hook, as `npm run hook -- install` writes it, so the page offers Review.
  writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
    hooks: { PermissionRequest: [{ hooks: [{ type: 'http', url: `http://127.0.0.1:${port}${HOOK_PATH}`, timeout: 3600 }] }] },
  }));

  // Only what git and the server need: none of your global git config, tmux server or gh login.
  // tmux gets a server of its own under root, and UTF-8, or it draws a dialog's ❯ and ─ as _.
  const {
    TMUX: _tmux, TMUX_PANE: _pane, GH_TOKEN: _gh, GITHUB_TOKEN: _github, XDG_CONFIG_HOME: _config, ...inherited
  } = process.env;
  const baseEnv = { ...inherited, HOME: home, GIT_CONFIG_NOSYSTEM: '1', TZ: 'UTC', TMUX_TMPDIR: root, LC_ALL: 'C.UTF-8' };
  const tips = buildRepos(code, makeGit(baseEnv), now);
  const { pids, approvals } = buildSessions({ code, claudeDir, now, env: baseEnv, root });
  const gh = installFakeGh(root, tips, now);
  // ClickUp connected, as the Tasks page leaves it: the token file, and a stand-in ClickUp to answer.
  writeFiles(join(home, '.config', 'switchyard'), {
    'task-tools.json': JSON.stringify({ clickup: { ...CLICKUP, workspaceId: CLICKUP.workspaces[0].id } }),
    'tasks.json': JSON.stringify({ tasks: hubTasks(now) }),
  });
  const clickup = startFakeClickUp({ port: port + 1, now });

  const env = {
    ...baseEnv,
    PATH: `${gh.bin}:${process.env.PATH}`,
    PORT: String(port),
    SWITCHYARD_ROOTS: code,
    SWITCHYARD_FAKE_GH: gh.fixture,
    SWITCHYARD_CLICKUP_API: clickup.url,
  };
  const stop = () => {
    clickup.stop();
    // The tmux server takes the sessions in its panes with it.
    try {
      execFileSync('tmux', ['kill-server'], { env: baseEnv, stdio: 'ignore' });
    } catch {
      // Not running.
    }
    pids.forEach((pid) => {
      try {
        process.kill(pid);
      } catch {
        // Already gone.
      }
    });
  };
  return { env, approvals, stop };
}
