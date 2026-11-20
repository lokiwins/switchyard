import { MODES as modes, THEMES as themes } from '../../../public/themes.js';
import * as terminal from '../../../public/terminal-themes.js';
import { currentXtermOptions as xtermNow, followTerminalLook as follow } from '../../../public/terminal-look.js';
import type { Appearance } from './appearance';

export interface Choice { id: string; label: string }
export const THEMES = themes as readonly Choice[];
export const MODES = modes as readonly Choice[];
export const TERMINAL_CHOICES = terminal.TERMINAL_CHOICES as readonly Choice[];
export const terminalPicker = terminal.terminalPicker as (a: Pick<Appearance, 'own' | 'defaults'>) =>
  { options: { value: string; label: string }[]; selected: string };
/** xterm.js's theme and contrast floor for the terminal colours chosen now. */
export const currentXtermOptions = xtermNow as () => Record<string, unknown>;
/** Keep the glass panes in the terminal colours, now and as they change. */
export const followTerminalLook = follow as () => void;
