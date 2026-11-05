import { join } from 'node:path';
import { loadConfig } from './config.js';
import { hookUrl, isHookInstalled, readClaudeSettings, withHook, withoutHook, writeClaudeSettings } from './claude-hook.js';

/*
 * npm run hook -- install | remove | status
 * Adds or removes the Claude Code hook that lets you answer permission prompts from switchyard.
 */

const COMMANDS = {
  install: (settings, port) => withHook(settings, port),
  remove: (settings, port) => withoutHook(settings, port),
};

async function main(command = 'status') {
  const { port, claudeDir } = loadConfig();
  const file = join(claudeDir, 'settings.json');
  const settings = await readClaudeSettings(file);
  const update = COMMANDS[command];
  if (command !== 'status' && !update) throw new Error('Usage: npm run hook -- install | remove | status');
  if (update) {
    const next = update(settings, port);
    if (next !== settings) await writeClaudeSettings(file, next);
  }
  const installed = isHookInstalled(update ? update(settings, port) : settings, port);
  process.stdout.write(installed
    ? `Permission prompts go to switchyard (${hookUrl(port)}), set in ${file}.\nSessions already running pick this up on their own.\n`
    : `Permission prompts are not sent to switchyard (no hook in ${file}).\n`);
}

main(process.argv[2]).catch((error) => {
  process.stderr.write(`switchyard: ${error.message}\n`);
  process.exit(1);
});
