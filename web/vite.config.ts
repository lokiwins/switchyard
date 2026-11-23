/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import { BUILT_PAGES } from '../src/built-pages.js';

/*
 * The pages, built to dist/ and served by src/server.js (see src/built-pages.js).
 * `npm run dev:web` serves them with hot reload, passing everything else on to a
 * running switchyard (SWITCHYARD_PORT, 4477 by default).
 */

const root = fileURLToPath(new URL('.', import.meta.url));
const DEV_PORT = 5173;
const target = `http://127.0.0.1:${process.env.SWITCHYARD_PORT ?? 4477}`;
const devOrigins = new Set([`http://localhost:${DEV_PORT}`, `http://127.0.0.1:${DEV_PORT}`]);
// What the dev server leaves to switchyard. A request from the dev page itself is sent on as
// switchyard's own origin, so its same-origin check passes; any other origin is sent as it came.
const SERVER_PATHS = ['/api', '/theme-boot.js'];
const toSwitchyard: ProxyOptions = {
  target,
  configure: (proxy) => {
    proxy.on('proxyReq', (req, incoming) => {
      if (devOrigins.has(incoming.headers.origin ?? '')) req.setHeader('origin', target);
    });
  },
};

/** In development, each page at its address (/prs), as the server serves the built ones (src/built-pages.js). */
const pagesAtTheirAddresses: Plugin = {
  name: 'switchyard-pages',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = (req.url ?? '').split('?');
      const page = path ? (BUILT_PAGES as Record<string, string>)[path] : undefined;
      if (page) req.url = `/${page}${query ? `?${query}` : ''}`;
      next();
    });
  },
};

export default defineConfig({
  root,
  plugins: [pagesAtTheirAddresses, react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rolldownOptions: { input: { agents: `${root}agents.html`, prs: `${root}prs.html`, worktrees: `${root}worktrees.html`, settings: `${root}settings.html`, tasks: `${root}tasks.html`, graph: `${root}graph.html` } },
  },
  server: {
    port: DEV_PORT,
    strictPort: true,
    proxy: Object.fromEntries(SERVER_PATHS.map((path) => [path, toSwitchyard])),
  },
  test: {
    environment: 'jsdom',
    // Where tests read the pages' source text from (src/styles/source.ts): a `?raw` CSS import comes over empty in Vitest.
    env: { SRC_DIR: `${root}src` },
    // The pages' tests, and those of the code the server shares with them (../shared).
    include: ['src/**/*.test.{ts,tsx}', '../shared/**/*.test.ts'],
  },
});
