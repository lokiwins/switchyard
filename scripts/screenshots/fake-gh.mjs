#!/usr/bin/env node
/*
 * A stand-in for the `gh` CLI, so the screenshot run shows pull requests
 * without a network or a GitHub login. It answers the calls switchyard makes
 * (see src/github.js, src/state.js, src/pr-sync.js) from the fixture file
 * named by SWITCHYARD_FAKE_GH, and fails on anything else, like gh would.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** `-f key=value` pairs of a `gh api graphql` call. */
function fieldValues(args) {
  const fields = {};
  args.forEach((arg, i) => {
    if (args[i - 1] !== '-f') return;
    const eq = arg.indexOf('=');
    if (eq > 0) fields[arg.slice(0, eq)] = arg.slice(eq + 1);
  });
  return fields;
}

const pick = (object, keys) => Object.fromEntries(keys.filter((k) => k in object).map((k) => [k, object[k]]));
const jsonFields = (args) => (args[args.indexOf('--json') + 1] ?? '').split(',').filter(Boolean);
const repoOf = (pr) => pr.repository.nameWithOwner;

/** The data of a batched branch-PR query: r<i>.b<j>.nodes for repo i's branch j. */
function branchPrs(args, prs) {
  const fields = fieldValues(args);
  const data = {};
  for (const [key, branch] of Object.entries(fields)) {
    const match = key.match(/^b(\d+)_(\d+)$/);
    if (!match) continue;
    const [, r, b] = match;
    const repo = `${fields[`o${r}`]}/${fields[`n${r}`]}`;
    const nodes = prs.filter((pr) => repoOf(pr) === repo && pr.headRefName === branch);
    data[`r${r}`] ??= {};
    data[`r${r}`][`b${b}`] = { nodes };
  }
  return { data };
}

/** Which fixture PRs a `gh search prs` call finds. */
function searchPrs(args, prs, viewer) {
  const open = prs.filter((pr) => pr.state === 'OPEN');
  if (args.includes('--author=@me')) return open.filter((pr) => pr.author.login === viewer);
  if (args.includes('user-review-requested:@me')) return open.filter((pr) => pr.requestedOfViewer === 'direct');
  if (args.includes('--review-requested=@me')) return open.filter((pr) => pr.requestedOfViewer);
  return open;
}

const flag = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

/** `gh pr list` for one repo, which releases before the batched branch query used. */
function listPrs(args, prs, viewer) {
  const state = flag(args, '--state') ?? 'open';
  const author = flag(args, '--author');
  return prs.filter((pr) => repoOf(pr) === flag(args, '--repo')
    && (state === 'all' || pr.state === state.toUpperCase())
    && (!author || pr.author.login === (author === '@me' ? viewer : author)));
}

/**
 * gh's stdout for `args`, or throws for a call the stub doesn't know.
 * @param {string[]} args
 * @param {{ viewer: string, prs: object[], issues?: object[] }} fixture
 */
export function respond(args, { viewer, prs, issues }) {
  const [command, sub] = args;
  if (command === 'api' && sub === 'user') return `${viewer}\n`;
  if (command === 'api' && sub === 'graphql') return JSON.stringify(branchPrs(args, prs));
  if (command === 'api' && args.includes('--method')) return '{}';
  if (command === 'search' && sub === 'prs') {
    return JSON.stringify(searchPrs(args, prs, viewer).map((pr) => pick(pr, jsonFields(args))));
  }
  if (command === 'pr' && sub === 'list') {
    return JSON.stringify(listPrs(args, prs, viewer).map((pr) => pick(pr, jsonFields(args))));
  }
  if (command === 'pr' && sub === 'view') {
    const repo = args[args.indexOf('--repo') + 1];
    const pr = prs.find((p) => repoOf(p) === repo && String(p.number) === args[2]);
    if (!pr) throw new Error(`no pull requests found for ${repo}#${args[2]}`);
    return JSON.stringify(pick(pr, jsonFields(args)));
  }
  if (command === 'issue' && sub === 'view') {
    const repo = args[args.indexOf('--repo') + 1];
    const issue = (issues ?? []).find((i) => i.repo === repo && String(i.number) === args[2]);
    if (!issue) throw new Error(`no issue found for ${repo}#${args[2]}`);
    return JSON.stringify(pick(issue, jsonFields(args)));
  }
  if (command === 'search' && sub === 'issues') {
    // gh search issues --assignee=@me --state=open: as GitHub's search gives them, newest change first.
    const found = (issues ?? []).filter((i) => i.assignees?.includes(viewer) && i.state === 'OPEN')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((i) => ({ ...i, state: 'open', repository: { nameWithOwner: i.repo } }));
    return JSON.stringify(found.map((i) => pick(i, jsonFields(args))));
  }
  throw new Error(`fake gh: unsupported call: gh ${args.join(' ')}`);
}

/** gh issue close/reopen: the fixture with that issue's state changed; null for any other call. */
export function change(args, fixture) {
  const [command, sub, number] = args;
  if (command !== 'issue' || !['close', 'reopen'].includes(sub)) return null;
  const repo = args[args.indexOf('--repo') + 1];
  const issue = (fixture.issues ?? []).find((i) => i.repo === repo && String(i.number) === number);
  if (!issue) throw new Error(`no issue found for ${repo}#${number}`);
  return { ...fixture, issues: fixture.issues.map((i) => (i === issue ? { ...i, state: sub === 'close' ? 'CLOSED' : 'OPEN' } : i)) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const fixture = JSON.parse(readFileSync(process.env.SWITCHYARD_FAKE_GH, 'utf8'));
    // Each call is a new process, so a change is kept in the fixture file.
    const changed = change(process.argv.slice(2), fixture);
    if (changed) writeFileSync(process.env.SWITCHYARD_FAKE_GH, JSON.stringify(changed));
    else process.stdout.write(respond(process.argv.slice(2), fixture));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
