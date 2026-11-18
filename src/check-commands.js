import YAML from 'yaml';
import { ActionError } from './errors.js';

/*
 * Settings › Checks is edited as YAML: each repo, then its named checks (or
 * just one command):
 *
 *   billing-api:
 *     lint: npm run lint
 *     test: npm test
 *   storefront: npm test
 *
 * config.json keeps the same thing as JSON; settings.js checks what's in it.
 */

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The commands in the Settings box's YAML; a 400 saying the line for a mistake. */
export function commandsFromText(text) {
  let parsed;
  try {
    parsed = YAML.parse(String(text ?? ''));
  } catch (error) {
    const line = error.linePos?.[0]?.line;
    const hint = error.code === 'BLOCK_AS_IMPLICIT_KEY' ? ' (put a command with ": " in it in quotes)' : '';
    throw new ActionError(400, `Check commands, ${line ? `line ${line}: ` : ''}${error.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '')}${hint}`);
  }
  if (parsed === null || parsed === undefined) return {};
  if (!isObject(parsed)) throw new ActionError(400, 'Check commands: start each line with a repo name and a colon, such as "billing-api:"');
  return parsed;
}

/** The commands as YAML for the Settings box ('' for none). */
export function commandsToText(commands) {
  return isObject(commands) && Object.keys(commands).length > 0 ? YAML.stringify(commands) : '';
}
