import { expect, test } from 'vitest';
import {
  DEFAULT_PR_REVIEW_INSTRUCTIONS, PR_PLACEHOLDERS, fillInstructions, parsePrVerdict, unknownPlaceholders,
} from './pr-review.ts';

const PR = {
  repo: 'acme/shop', number: 7, title: 'Round totals half up', url: 'https://github.com/acme/shop/pull/7',
  author: 'sam', base: 'main', head: 'fix-totals', body: 'Totals were off by a cent.', files: ['src/totals.js', 'test/totals.test.js'],
};

test('the default instructions use only placeholders switchyard fills', () => {
  expect(unknownPlaceholders(DEFAULT_PR_REVIEW_INSTRUCTIONS)).toEqual([]);
  for (const name of ['pr.title', 'pr.url', 'pr.base', 'pr.files']) expect(DEFAULT_PR_REVIEW_INSTRUCTIONS).toContain(`{{${name}}}`);
});

test('the default instructions ask for the verdict switchyard reads, and say not to change or post anything', () => {
  for (const words of ['`Approve`', '`Request Changes`', '`Needs Clarification`', "Don't change any files", 'GitHub']) {
    expect(DEFAULT_PR_REVIEW_INSTRUCTIONS).toContain(words);
  }
});

test('placeholders are filled from the PR', () => {
  const text = fillInstructions('{{pr.repo}}#{{pr.number}} by {{ pr.author }}: {{pr.title}}\n{{pr.files}}\nbase {{pr.base}}, head {{pr.head}}', PR);
  expect(text).toBe('acme/shop#7 by sam: Round totals half up\n- src/totals.js\n- test/totals.test.js\nbase main, head fix-totals');
});

test('an empty description and no files still read sensibly', () => {
  expect(fillInstructions('{{pr.body}}|{{pr.files}}', { ...PR, body: '  ', files: [] })).toBe('(no description)|(no files listed)');
});

test('a long file list is cut, saying how many more', () => {
  const files = Array.from({ length: 305 }, (_, i) => `f${i}.js`);
  const text = fillInstructions('{{pr.files}}', { ...PR, files });
  expect(text.split('\n')).toHaveLength(301);
  expect(text.endsWith('…and 5 more')).toBe(true);
});

test('a placeholder switchyard doesn\'t know is reported, once', () => {
  expect(unknownPlaceholders('{{pr.title}} {{pr.labels}} {{ticket}} {{pr.labels}}')).toEqual(['pr.labels', 'ticket']);
  expect(Object.keys(PR_PLACEHOLDERS)).toContain('pr.body');
});

test('the verdict is the last one the reply gives', () => {
  expect(parsePrVerdict('**Summary:** …\n**Verdict:** `Approve` — small and tested.')).toBe('approve');
  expect(parsePrVerdict('- **Verdict:** Request Changes, the migration drops a column')).toBe('changes');
  expect(parsePrVerdict('Verdict: needs clarification (what should happen offline?)')).toBe('clarify');
  expect(parsePrVerdict('Not `Approve` yet.\n\n**Verdict:** `Request Changes`')).toBe('changes');
  for (const text of [null, '', 'Looks fine to me', 'I approve']) expect(parsePrVerdict(text)).toBe(null);
});

test('the instructions\' own Verdict line, quoted back, isn\'t taken for the verdict', () => {
  const quoted = '- **Verdict:** `Approve`, `Request Changes`, or `Needs Clarification` + brief reason.';
  expect(parsePrVerdict(`**Verdict:** \`Request Changes\`: no tests.\n\nYou asked for:\n${quoted}`)).toBe('changes');
  expect(parsePrVerdict(quoted)).toBe(null);
});
