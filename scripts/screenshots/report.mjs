#!/usr/bin/env node
/*
 * Turns a base-vs-head screenshot comparison into Markdown: a PR comment
 * showing what changed on screen, or a Screenshots section for release notes.
 *
 *   node report.mjs --report report.json --images <url prefix> --mode pr|release [--ui-changed]
 *
 * PR images are served as <prefix>/{base,head}/<scene>.png (the screenshots
 * branch); release images as <prefix>/screenshot-<scene>.png (files attached
 * to the release).
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const COMMENT_MARKER = '<!-- switchyard-screenshots -->';

/** @typedef {'new'|'changed'|'same'|'removed'|'failed'} SceneStatus */

/**
 * One entry per scene: how head's screenshot compares with base's.
 * @param {Record<string, {title: string, ok: boolean, error?: string}>} base manifest (empty if base has none)
 * @param {Record<string, {title: string, ok: boolean, error?: string}>} head manifest
 * @param {Record<string, boolean>} differs scene -> pixels differ, for scenes captured on both sides
 * @returns {{ name: string, title: string, status: SceneStatus, error?: string }[]}
 */
export function classify(base, head, differs) {
  const current = Object.entries(head).map(([name, shot]) => {
    if (!shot.ok) return { name, title: shot.title, status: 'failed', error: shot.error };
    if (!base[name]?.ok) return { name, title: shot.title, status: 'new' };
    return { name, title: shot.title, status: differs[name] ? 'changed' : 'same' };
  });
  const removed = Object.entries(base)
    .filter(([name]) => !(name in head))
    .map(([name, shot]) => ({ name, title: shot.title, status: 'removed' }));
  return [...current, ...removed];
}

/** The file a scene's screenshot is attached to a release as. */
export const releaseAssetName = (name) => `screenshot-${name}.png`;

export const isVisible = (entry) => entry.status === 'new' || entry.status === 'changed';

const image = (alt, url) => `<img alt="${alt.replace(/"/g, '&quot;')}" src="${url}" width="800">`;

function prSection(entry, imageUrl) {
  if (entry.status === 'new') return `#### ${entry.title} (new)\n\n${image(entry.title, imageUrl('head', entry.name))}`;
  return [
    `#### ${entry.title} (changed)`,
    '',
    '<table><tr><th>Before</th><th>After</th></tr><tr>',
    `<td>${image(`${entry.title}, before`, imageUrl('base', entry.name))}</td>`,
    `<td>${image(`${entry.title}, after`, imageUrl('head', entry.name))}</td>`,
    '</tr></table>',
  ].join('\n');
}

/**
 * The sticky PR comment.
 * @param {ReturnType<typeof classify>} entries
 * @param {{ imageUrl: (side: 'base'|'head', name: string) => string, uiChanged: boolean, baseRef: string }} options
 */
export function prComment(entries, { imageUrl, uiChanged, baseRef }) {
  const shown = entries.filter(isVisible);
  const failed = entries.filter((e) => e.status === 'failed');
  const removed = entries.filter((e) => e.status === 'removed');
  const same = entries.filter((e) => e.status === 'same');
  const parts = [COMMENT_MARKER, '### Screenshots', ''];
  if (shown.length > 0) {
    parts.push(`What looks different from \`${baseRef}\`, on the made-up data in \`scripts/screenshots\`. These go into the release notes.`, '');
    shown.forEach((entry) => parts.push(prSection(entry, imageUrl), ''));
  } else if (uiChanged) {
    parts.push('This PR changes files under `public/` but no screenshot looks different. If it adds or changes something on screen, add or update a scene in `scripts/screenshots/scenes.mjs` so it shows here and in the release notes.', '');
  } else {
    parts.push(`Nothing looks different from \`${baseRef}\`.`, '');
  }
  if (failed.length > 0) {
    parts.push('**Could not capture:**', ...failed.map((e) => `- \`${e.name}\`: ${e.error}`), '');
  }
  if (removed.length > 0) parts.push(`Scenes removed: ${removed.map((e) => `\`${e.name}\``).join(', ')}`, '');
  if (same.length > 0) parts.push(`Unchanged: ${same.map((e) => `\`${e.name}\``).join(', ')}`);
  return `${parts.join('\n').trim()}\n`;
}

/**
 * The Screenshots section of a release's notes, or '' when nothing looks different.
 * @param {ReturnType<typeof classify>} entries
 * @param {{ imageUrl: (side: 'base'|'head', name: string) => string }} options
 */
export function releaseSection(entries, { imageUrl }) {
  const shown = entries.filter(isVisible);
  if (shown.length === 0) return '';
  const sections = shown.map((e) => `### ${e.title}${e.status === 'new' ? ' (new)' : ''}\n\n${image(e.title, imageUrl('head', e.name))}`);
  return `## Screenshots\n\n${sections.join('\n\n')}\n`;
}

function main() {
  const { values } = parseArgs({
    options: {
      report: { type: 'string' },
      images: { type: 'string' },
      mode: { type: 'string' },
      'ui-changed': { type: 'boolean', default: false },
      'base-ref': { type: 'string', default: 'main' },
    },
  });
  if (!values.report || !values.images || !['pr', 'release'].includes(values.mode)) {
    throw new Error('Usage: report.mjs --report report.json --images <url prefix> --mode pr|release [--ui-changed] [--base-ref main]');
  }
  const { entries } = JSON.parse(readFileSync(values.report, 'utf8'));
  const prefix = values.images.replace(/\/$/, '');
  process.stdout.write(values.mode === 'pr'
    ? prComment(entries, { imageUrl: (side, name) => `${prefix}/${side}/${name}.png`, uiChanged: values['ui-changed'], baseRef: values['base-ref'] })
    : releaseSection(entries, { imageUrl: (_side, name) => `${prefix}/${releaseAssetName(name)}` }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
