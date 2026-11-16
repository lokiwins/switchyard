import { createHash } from 'node:crypto';

/*
 * The Worktrees page asks for /api/state every few seconds, and most answers
 * are the same as the last one but for when it was built. Each answer names
 * its version (a hash of everything but generatedAt); when the page already
 * has that version it is told so (304) instead of being sent ~200KB again,
 * and it leaves its list alone, so a selection or focus in it isn't lost.
 */

const TAG_LENGTH = 16;

/** The version of the page's data: a quoted hash of all of it but when it was built. */
export function stateEtag(data) {
  const { generatedAt: _built, ...rest } = data;
  return `"${createHash('sha1').update(JSON.stringify(rest)).digest('hex').slice(0, TAG_LENGTH)}"`;
}

/** Whether an If-None-Match header names `etag`: alone, in a list, weak (W/) or as *. */
export function ifNoneMatchHit(header, etag) {
  if (typeof header !== 'string' || header.trim() === '') return false;
  return header.split(',').map((tag) => tag.trim().replace(/^W\//, '')).some((tag) => tag === '*' || tag === etag);
}

/**
 * The answer to a poll for `data` from a page that has the version in
 * `ifNoneMatch`: 304 with no body when it's the same, else 200 with all of it.
 * Both say the version and when the data was built.
 */
export function conditionalState(ifNoneMatch, data) {
  const etag = stateEtag(data);
  const headers = { ETag: etag, 'X-Generated-At': String(data.generatedAt) };
  if (ifNoneMatchHit(ifNoneMatch, etag)) return { status: 304, headers };
  return { status: 200, headers, body: JSON.stringify({ success: true, data }) };
}
