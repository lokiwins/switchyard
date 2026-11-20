/*
 * xterm.js, its fit and WebGL addons and its stylesheet: imported only by
 * connection.ts, with import(), so they're a chunk of their own, loaded the
 * first time a terminal is wanted.
 */
import '@xterm/xterm/css/xterm.css';

export { Terminal } from '@xterm/xterm';
export { FitAddon } from '@xterm/addon-fit';
export { WebglAddon } from '@xterm/addon-webgl';
