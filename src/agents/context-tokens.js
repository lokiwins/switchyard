/*
 * Rough token counts for what a transcript entry puts into Claude's context.
 * Claude Code records exact usage only per API call, not per file or tool
 * result, so each piece is estimated from its size: about 4 characters a
 * token for text, and a fixed amount for an image.
 */

const CHARS_PER_TOKEN = 4;
const IMAGE_TOKENS = 1600;

/** Estimated tokens for a string, a list of content parts (text, images…), or any other JSON value. */
export function estimateTokens(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return Math.ceil(value.length / CHARS_PER_TOKEN);
  if (Array.isArray(value)) return value.reduce((sum, part) => sum + estimatePart(part), 0);
  return Math.ceil(JSON.stringify(value).length / CHARS_PER_TOKEN);
}

function estimatePart(part) {
  if (typeof part === 'string') return estimateTokens(part);
  if (part?.type === 'text') return estimateTokens(part.text ?? '');
  if (part?.type === 'image') return IMAGE_TOKENS;
  return estimateTokens(part);
}

/** The context an API call read: its uncached, cache-read and cache-written input; null without usage. */
export function contextSize(usage) {
  if (!usage || typeof usage.input_tokens !== 'number') return null;
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}
