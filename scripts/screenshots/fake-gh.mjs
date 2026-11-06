#!/usr/bin/env node
/*
 * A stand-in for the `gh` CLI, so the screenshot run shows pull requests
 * without a network or a GitHub login. It answers the calls switchyard makes
 * (see src/github.js, src/state.js, src/pr-sync.js) from the fixture file
 * named by SWITCHYARD_FAKE_GH, and fails on anything else, like gh would.
 */
import { readFileSync } from 'node:fs';
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

/**
 * gh's stdout for `args`, or throws for a call the stub doesn't know.
 * @param {string[]} args
 * @param {{ viewer: string, prs: object[] }} fixture
 */
export function respond(args, { viewer, prs }) {
  const [command, sub] = args;
  if (command === 'api' && sub === 'user') return `${viewer}\n`;
  if (command === 'api' && sub === 'graphql') return JSON.stringify(branchPrs(args, prs));
  if (command === 'api' && args.includes('--method')) return '{}';
  if (command === 'search' && sub === 'prs') {
    return JSON.stringify(searchPrs(args, prs, viewer).map((pr) => pick(pr, jsonFields(args))));
  }
  if (command === 'pr' && sub === 'view') {
    const repo = args[args.indexOf('--repo') + 1];
    const pr = prs.find((p) => repoOf(p) === repo && String(p.number) === args[2]);
    if (!pr) throw new Error(`no pull requests found for ${repo}#${args[2]}`);
    return JSON.stringify(pick(pr, jsonFields(args)));
  }
  throw new Error(`fake gh: unsupported call: gh ${args.join(' ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const fixture = JSON.parse(readFileSync(process.env.SWITCHYARD_FAKE_GH, 'utf8'));
    process.stdout.write(respond(process.argv.slice(2), fixture));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
