#!/usr/bin/env node
/*
 * Screenshots of switchyard running against the fixture world.
 *
 *   node capture.mjs --out <dir> <label>=<checkout> [<label>=<checkout> ...]
 *
 *   --home <empty dir>  HOME for the fixtures (default: a temp dir). The page
 *                       shortens /home/<name>/… to ~/…, so CI uses /home/dev.
 *
 * Each checkout (e.g. base=../base head=../..) is started in turn against the
 * same fixtures and the same frozen clock, so two captures differ only where
 * the code does. Writes <out>/<label>/<scene>.png and <out>/<label>/manifest.json.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { buildFixtures } from './fixtures.mjs';
import { SCENES } from './scenes.mjs';

const DEFAULT_PORT = 4499;
const VIEWPORT = { width: 1280, height: 800 };
const SERVER_START_MS = 15_000;
const SCENE_TIMEOUT_MS = 20_000;
// Long enough for a page's first refresh to finish drawing after its data arrives.
const RENDER_SETTLE_MS = 500;

function parseCli() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, home: { type: 'string' }, port: { type: 'string', default: String(DEFAULT_PORT) } },
  });
  if (!values.out || positionals.length === 0) {
    throw new Error('Usage: capture.mjs --out <dir> <label>=<checkout> [<label>=<checkout> ...]');
  }
  const apps = positionals.map((arg) => {
    const [label, dir] = arg.split('=');
    if (!/^[a-z0-9-]+$/.test(label ?? '') || !dir) throw new Error(`Expected <label>=<checkout>, got "${arg}"`);
    return { label, dir: resolve(dir) };
  });
  return { out: resolve(values.out), home: values.home && resolve(values.home), port: Number(values.port), apps };
}

/** A checkout's own config.json would point the server at your real repos and sessions. */
function assertCleanCheckout(dir) {
  if (!existsSync(join(dir, 'src', 'server.js'))) throw new Error(`${dir} is not a switchyard checkout`);
  if (existsSync(join(dir, 'config.json'))) {
    throw new Error(`${dir} has a config.json, which would show your own data in the screenshots. Capture from a worktree without one.`);
  }
}

/** --home becomes the server's HOME and gets fixture repos and sessions, so it must start empty. */
function assertEmptyHome(home) {
  if (home && existsSync(home) && readdirSync(home).length > 0) throw new Error(`--home ${home} must be empty or not exist yet`);
}

async function waitForServer(port, child) {
  const deadline = Date.now() + SERVER_START_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`switchyard exited with code ${child.exitCode}`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/nav`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`switchyard did not start on port ${port}`);
}

async function startServer(dir, env, port) {
  const child = spawn(process.execPath, ['src/server.js'], { cwd: dir, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    await waitForServer(port, child);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${stderr}`);
  }
  return child;
}

/** Sends the fixture's permission prompts as Claude Code's hook would; they stay open until aborted. */
function raiseApprovals(approvals, port, signal) {
  for (const payload of approvals) {
    fetch(`http://127.0.0.1:${port}/hooks/permission-request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal,
    }).catch(() => {});
  }
}

async function captureScene(browser, scene, { port, now, file }) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce', timezoneId: 'UTC', locale: 'en-US',
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(SCENE_TIMEOUT_MS);
    await page.clock.setFixedTime(now);
    await page.goto(`http://127.0.0.1:${port}${scene.path}`);
    await scene.prepare?.(page);
    await page.waitForTimeout(RENDER_SETTLE_MS);
    await page.screenshot({ path: file, fullPage: Boolean(scene.fullPage), animations: 'disabled', caret: 'hide' });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message.split('\n')[0] };
  } finally {
    await context.close();
  }
}

async function captureApp(app, { browser, fixtures, port, now, out }) {
  assertCleanCheckout(app.dir);
  const dir = join(out, app.label);
  mkdirSync(dir, { recursive: true });
  const server = await startServer(app.dir, fixtures.env, port);
  const approvals = new AbortController();
  try {
    raiseApprovals(fixtures.approvals, port, approvals.signal);
    const manifest = {};
    for (const scene of SCENES) {
      const result = await captureScene(browser, scene, { port, now, file: join(dir, `${scene.name}.png`) });
      manifest[scene.name] = { title: scene.title, ...result };
      console.log(`${app.label}/${scene.name}: ${result.ok ? 'ok' : `failed: ${result.error}`}`);
    }
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } finally {
    approvals.abort();
    server.kill();
  }
}

async function main() {
  const { out, home, port, apps } = parseCli();
  assertEmptyHome(home);
  apps.forEach((app) => assertCleanCheckout(app.dir));
  const root = mkdtempSync(join(tmpdir(), 'switchyard-shots-'));
  const now = Date.now();
  const fixtures = buildFixtures({ root, home, port, now });
  let browser;
  try {
    browser = await chromium.launch();
    for (const app of apps) await captureApp(app, { browser, fixtures, port, now, out });
  } finally {
    await browser?.close();
    fixtures.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
