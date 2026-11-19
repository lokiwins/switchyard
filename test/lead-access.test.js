import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LEAD_SETTINGS, createLeadAccess, mcpConfigFor } from '../src/lead-access.js';

const LEAD = 'sy-k3x9q2';
const freshDir = () => mkdtempSync(join(tmpdir(), 'switchyard-lead-'));
const mode = (path) => statSync(path).mode & 0o777;

test('a lead\'s token says which task it leads, and only that task', async () => {
  const access = createLeadAccess({ dir: freshDir(), port: 4477 });
  const token = await access.tokenFor(LEAD);
  assert.ok(token.startsWith(`${LEAD}.`));
  assert.equal(await access.leadFrom(`Bearer ${token}`), LEAD);
});

test('a token that was changed, made up, or missing leads nothing', async () => {
  const access = createLeadAccess({ dir: freshDir(), port: 4477 });
  const token = await access.tokenFor(LEAD);
  const [, signature] = token.split('.');
  for (const header of [
    undefined, '', 'Bearer', `Basic ${token}`, `Bearer ${token}x`, `Bearer sy-other0.${signature}`,
    `Bearer ${LEAD}.${'0'.repeat(signature.length)}`, `Bearer ${LEAD}`, `Bearer ../etc.${signature}`,
  ]) {
    assert.equal(await access.leadFrom(header), null, String(header));
  }
});

test('tokens are signed with a secret kept in a file only you can read, so they survive a restart', async () => {
  const dir = freshDir();
  const token = await createLeadAccess({ dir, port: 4477 }).tokenFor(LEAD);
  assert.equal(mode(join(dir, 'mcp-secret')), 0o600);
  // A new server (a restart) reads the same secret: the running lead keeps working.
  assert.equal(await createLeadAccess({ dir, port: 4477 }).leadFrom(`Bearer ${token}`), LEAD);
  // Another machine's switchyard (another secret) doesn't accept it.
  assert.equal(await createLeadAccess({ dir: freshDir(), port: 4477 }).leadFrom(`Bearer ${token}`), null);
});

test('the MCP config Claude is started with points at this switchyard, with the lead\'s token', () => {
  assert.deepEqual(mcpConfigFor({ port: 4477, token: 'sy-k3x9q2.abc' }), {
    mcpServers: {
      switchyard: { type: 'http', url: 'http://127.0.0.1:4477/mcp', headers: { Authorization: 'Bearer sy-k3x9q2.abc' } },
    },
  });
});

test('the config is written to a file only you can read, not typed where the screen or ps would show the token', async () => {
  const dir = freshDir();
  const access = createLeadAccess({ dir, port: 4499 });
  const files = await access.writeConfig(LEAD);
  assert.equal(files.mcpConfig, join(dir, 'leads', `${LEAD}.mcp.json`));
  assert.equal(mode(files.mcpConfig), 0o600);
  assert.equal(mode(join(dir, 'leads')), 0o700);
  const config = JSON.parse(readFileSync(files.mcpConfig, 'utf8'));
  assert.equal(config.mcpServers.switchyard.url, 'http://127.0.0.1:4499/mcp');
  assert.equal(await access.leadFrom(config.mcpServers.switchyard.headers.Authorization), LEAD);
});

test('the lead\'s settings make Claude ask you before it uses switchyard\'s tools, whatever its permission mode', async () => {
  // Claude Code's auto mode would otherwise run them by itself; an ask rule still asks.
  assert.deepEqual(LEAD_SETTINGS, { permissions: { ask: ['mcp__switchyard'] } });
  const dir = freshDir();
  const files = await createLeadAccess({ dir, port: 4477 }).writeConfig(LEAD);
  assert.equal(files.settings, join(dir, 'leads', `${LEAD}.settings.json`));
  assert.deepEqual(JSON.parse(readFileSync(files.settings, 'utf8')), LEAD_SETTINGS);
});

test('only a task id gets a config file', async () => {
  const access = createLeadAccess({ dir: freshDir(), port: 4477 });
  await assert.rejects(access.writeConfig('../../x'), /task id/);
});

test('a damaged secret file is not replaced (that would sign every running lead out); it is an error', async () => {
  const dir = freshDir();
  writeFileSync(join(dir, 'mcp-secret'), 'not a secret\n');
  await assert.rejects(createLeadAccess({ dir, port: 4477 }).tokenFor(LEAD), /mcp-secret/);
  assert.equal(readFileSync(join(dir, 'mcp-secret'), 'utf8'), 'not a secret\n');
});
