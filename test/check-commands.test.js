import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandsFromText, commandsToText } from '../src/check-commands.js';

test('the Settings text is YAML: a repo, then its named checks, or just a command', () => {
  const text = 'billing-api:\n  lint: npm run lint\n  test: npm test   # the unit tests\nstorefront: npm test\n';
  assert.deepEqual(commandsFromText(text), { 'billing-api': { lint: 'npm run lint', test: 'npm test' }, storefront: 'npm test' });
  assert.deepEqual(commandsFromText(''), {});
  assert.deepEqual(commandsFromText('  \n# nothing yet\n'), {});
});

test('a YAML mistake is refused with the line it is on', () => {
  assert.throws(() => commandsFromText('a:\n  t: x\n  t: y'), (e) => e.status === 400 && /line 3/i.test(e.message) && /unique/.test(e.message));
  assert.throws(() => commandsFromText('a:\n  t: echo a: b'), (e) => e.status === 400 && /line 2/i.test(e.message) && /quote/i.test(e.message));
  assert.throws(() => commandsFromText('- billing-api'), (e) => e.status === 400 && /repo/.test(e.message));
});

test('the commands as YAML again, for the Settings box; quoted where YAML needs it', () => {
  assert.equal(commandsToText({}), '');
  assert.equal(commandsToText(undefined), '');
  const text = commandsToText({ 'billing-api': { lint: 'npm run lint', deploy: 'echo a: b' } });
  assert.equal(text, 'billing-api:\n  lint: npm run lint\n  deploy: "echo a: b"\n');
  assert.deepEqual(commandsFromText(text), { 'billing-api': { lint: 'npm run lint', deploy: 'echo a: b' } });
});
