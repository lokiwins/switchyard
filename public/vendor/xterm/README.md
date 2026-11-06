# Vendored xterm.js

Copied unchanged from the npm packages, except that the `//# sourceMappingURL` line is removed:

| File | Package | From |
|---|---|---|
| `xterm.mjs` | `@xterm/xterm` 6.0.0 | `lib/xterm.mjs` |
| `xterm.css` | `@xterm/xterm` 6.0.0 | `css/xterm.css` |
| `addon-fit.mjs` | `@xterm/addon-fit` 0.11.0 | `lib/addon-fit.mjs` |
| `addon-webgl.mjs` | `@xterm/addon-webgl` 0.19.0 | `lib/addon-webgl.mjs` |

All are MIT-licensed (`LICENSE-xterm`, `LICENSE-addon-fit`, `LICENSE-addon-webgl`).

The terminal draws with the WebGL add-on: xterm.js's default DOM renderer colours cells with `style` attributes, which the page's Content-Security-Policy doesn't allow. To update, `npm pack` the new versions and copy the same files.
