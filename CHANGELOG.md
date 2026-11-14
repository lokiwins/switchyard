# Changelog

## [0.4.0](https://github.com/lokiwins/switchyard/compare/v0.3.0...v0.4.0) (2026-11-14)


### Features

* make a task from a session or worktree, linked to its work ([#54](https://github.com/lokiwins/switchyard/issues/54)) ([395a719](https://github.com/lokiwins/switchyard/commit/395a7194bc4aa436f7f273e144f5173f949ff967))

## [0.3.0](https://github.com/lokiwins/switchyard/compare/v0.2.0...v0.3.0) (2026-11-13)


### Features

* a live context graph for each session, from its transcript ([#49](https://github.com/lokiwins/switchyard/issues/49)) ([1be72cb](https://github.com/lokiwins/switchyard/commit/1be72cb8f0fe84f34e2c27b5d7a7a78fa601736b))
* a Settings page that edits config.json and applies changes at once ([#46](https://github.com/lokiwins/switchyard/issues/46)) ([557a5bc](https://github.com/lokiwins/switchyard/commit/557a5bc2d6942de67dd5d2e517e0206229064e94))
* a task's details pane: edit it, read its tickets, change a ClickUp status ([#41](https://github.com/lokiwins/switchyard/issues/41)) ([117a3eb](https://github.com/lokiwins/switchyard/commit/117a3eb519508a7287d4369bc48005eed483cfba))
* a Tasks page that lists your open ClickUp tasks ([#30](https://github.com/lokiwins/switchyard/issues/30)) ([4ca14ae](https://github.com/lokiwins/switchyard/commit/4ca14ae186a2ea6758c09fec3b8a0e4bf25eb270))
* add tasks from your ClickUp tickets, and connect ClickUp from the header ([#40](https://github.com/lokiwins/switchyard/issues/40)) ([affe7e5](https://github.com/lokiwins/switchyard/commit/affe7e5d9450572ae0fc5e21327e4d245cda8989))
* answer a waiting tmux session's dialog from the page, and read its plan ([#23](https://github.com/lokiwins/switchyard/issues/23)) ([ee01eb4](https://github.com/lokiwins/switchyard/commit/ee01eb4ce6174b48109130cdb8940ad6b6dfde27))
* answer Claude's trust prompt from the New task row, and know at once when it quits ([#36](https://github.com/lokiwins/switchyard/issues/36)) ([b17f1e3](https://github.com/lokiwins/switchyard/commit/b17f1e39198b4bd60ee31af04b6dd21dd7c1a28b))
* import tasks from GitHub issues, with a tab per tracker in Add from ▾ ([#42](https://github.com/lokiwins/switchyard/issues/42)) ([21958ed](https://github.com/lokiwins/switchyard/commit/21958edc721d49de17dea2ed828a706fb055a46e))
* Jump opens a tmux task in a terminal tab of its own ([#24](https://github.com/lokiwins/switchyard/issues/24)) ([40bd2c6](https://github.com/lokiwins/switchyard/commit/40bd2c61f1c89cf631f5adc3d518e7fd5e0d7437))
* link each ClickUp task to the worktree and Claude session working on it ([#32](https://github.com/lokiwins/switchyard/issues/32)) ([af7c55f](https://github.com/lokiwins/switchyard/commit/af7c55f0c5acba9a0e82c22add0571bef1d9ed9b))
* push Agents page updates as sessions change ([#20](https://github.com/lokiwins/switchyard/issues/20)) ([8f311ef](https://github.com/lokiwins/switchyard/commit/8f311ef21644a858fc31850feb40dc5e6651c555))
* read and answer a waiting session's dialog in an iTerm tab too ([#26](https://github.com/lokiwins/switchyard/issues/26)) ([f1449ab](https://github.com/lokiwins/switchyard/commit/f1449ab3431970602e1ebb5ea9bec9f0220b0ce3))
* resize the live terminal by dragging its left edge ([#37](https://github.com/lokiwins/switchyard/issues/37)) ([e5ba9fe](https://github.com/lokiwins/switchyard/commit/e5ba9fe3ecbf77f7faeb33aa0521f7ed0bab1c48))
* Show Terminal Sessions opens every task's tmux window in iTerm ([#45](https://github.com/lokiwins/switchyard/issues/45)) ([f4003ad](https://github.com/lokiwins/switchyard/commit/f4003adbbb4451db484a97ceafff6cfd52565da0))
* show what a Terminal session asks, and say where to answer what the page can't ([#28](https://github.com/lokiwins/switchyard/issues/28)) ([7cdc0f1](https://github.com/lokiwins/switchyard/commit/7cdc0f1a94f199030f9cc8e8d5f505927797dca7))
* show what a waiting tmux session is asking, read off its screen ([#22](https://github.com/lokiwins/switchyard/issues/22)) ([53e042b](https://github.com/lokiwins/switchyard/commit/53e042b715979f19091ae6d16fde23f741c27e8c))
* size the session graph's nodes by the tokens they put into context ([#50](https://github.com/lokiwins/switchyard/issues/50)) ([e6a13e4](https://github.com/lokiwins/switchyard/commit/e6a13e46c95e2e6075003cdc76c71004fd7456fd))
* start Claude on a task from the Tasks page, and work its session from the row ([#39](https://github.com/lokiwins/switchyard/issues/39)) ([33c71ac](https://github.com/lokiwins/switchyard/commit/33c71ac406ef1acd6e797dce70c23c5963119d9f))
* the Tasks page becomes a hub of your own tasks, what needs you first ([#38](https://github.com/lokiwins/switchyard/issues/38)) ([d9726db](https://github.com/lokiwins/switchyard/commit/d9726db82be51f05c80b58f9f23c01d8e8bbd1c5))


### Bug Fixes

* choose which repos the GitHub issues list shows, on the Settings page ([#47](https://github.com/lokiwins/switchyard/issues/47)) ([6059081](https://github.com/lokiwins/switchyard/commit/6059081c3d03dde9634d4c402e090977b15f44d3))
* End a task's session from the page, closing its tmux window ([#48](https://github.com/lokiwins/switchyard/issues/48)) ([2b70c35](https://github.com/lokiwins/switchyard/commit/2b70c35bf6f00f2f57f9544d1de4f9e1c29d66e6))
* every Graph button uses one graph tab, which has a Close button ([#53](https://github.com/lokiwins/switchyard/issues/53)) ([ec1d17c](https://github.com/lokiwins/switchyard/commit/ec1d17cc8338c062fc7b1139a45b0fd0b007c7e0))
* every page fits a phone screen, top bar included ([#35](https://github.com/lokiwins/switchyard/issues/35)) ([97feeed](https://github.com/lokiwins/switchyard/commit/97feeedf5d7314b8715fd9383c4253538ee02c1a))
* hide Next on a question's last tab, and offer Tab to amend from the page ([#25](https://github.com/lokiwins/switchyard/issues/25)) ([5b47788](https://github.com/lokiwins/switchyard/commit/5b47788dc43ff91ed408c279f1d49ba9e40edbdf))
* keep parked sessions whose tab is still open in the Agents list ([#44](https://github.com/lokiwins/switchyard/issues/44)) ([5f319d4](https://github.com/lokiwins/switchyard/commit/5f319d44595a0db8a23233e7da8020f33f9ff330))
* leave plan approvals to the terminal, like questions ([#27](https://github.com/lokiwins/switchyard/issues/27)) ([3dd257d](https://github.com/lokiwins/switchyard/commit/3dd257dfd6a70e1cbbccee6d61aad6e855a63daa))
* New task shows a "Creating…" row at once, replaced by the session when it starts ([#34](https://github.com/lokiwins/switchyard/issues/34)) ([89fe61e](https://github.com/lokiwins/switchyard/commit/89fe61ec70d9df8c22c97890f8c1e6bb0dda7f96))
* scrolling inside the terminal or a review pane no longer scrolls the page behind it ([#33](https://github.com/lokiwins/switchyard/issues/33)) ([58c90f0](https://github.com/lokiwins/switchyard/commit/58c90f04538cd5c86e4145faa34696c1a736c0a1))
* Shift+Enter starts a new line in the live terminal instead of submitting ([#31](https://github.com/lokiwins/switchyard/issues/31)) ([655ba4e](https://github.com/lokiwins/switchyard/commit/655ba4e6abf471ff4458bf2ff23a959d7cb673b8))


### Performance

* draw big session graphs twice as fast, and stop updating hidden graph tabs ([#52](https://github.com/lokiwins/switchyard/issues/52)) ([8199656](https://github.com/lokiwins/switchyard/commit/8199656c0249e09e7115f8da9ee97b17f53e5482))

## [0.2.0](https://github.com/lokiwins/switchyard/compare/v0.1.0...v0.2.0) (2026-11-06)


### Features

* allow or deny permission prompts and reply to sessions from the Agents page ([#7](https://github.com/lokiwins/switchyard/issues/7)) ([4eae928](https://github.com/lokiwins/switchyard/commit/4eae9289dbb22fff66f00be844fc127f1958bd04))
* Clean up removes a finished worktree after checking nothing would be lost ([#15](https://github.com/lokiwins/switchyard/issues/15)) ([21fc668](https://github.com/lokiwins/switchyard/commit/21fc6687b298942bd19097c134844020af00d645))
* live terminal flow control and reconnecting ([#10](https://github.com/lokiwins/switchyard/issues/10)) ([ce35c30](https://github.com/lokiwins/switchyard/commit/ce35c305ede46c207418c29d691c3d264fefa50c))
* live terminal for tmux sessions in a glass pane on the Agents page ([#9](https://github.com/lokiwins/switchyard/issues/9)) ([882972d](https://github.com/lokiwins/switchyard/commit/882972d13d99d3f808a9b69441e48d0eec0099eb))
* New task needs the task; the branch is optional and named after it ([#12](https://github.com/lokiwins/switchyard/issues/12)) ([c99c83e](https://github.com/lokiwins/switchyard/commit/c99c83ebce112dfc2c4c412b214cb94f43e8278d))
* New task starts Claude in a worktree, in a tab of a switchyard tmux session ([#8](https://github.com/lokiwins/switchyard/issues/8)) ([ed70da7](https://github.com/lokiwins/switchyard/commit/ed70da7ac14878f0617a95ad4f84bec6d9ab0065))
* resume sessions as tabs of the switchyard tmux session ([#16](https://github.com/lokiwins/switchyard/issues/16)) ([c5e06b5](https://github.com/lokiwins/switchyard/commit/c5e06b56f2f3c0b2f77e1ca662ce8f65c5c86cb1))
* review a permission prompt in full in the glass pane before answering it ([#14](https://github.com/lokiwins/switchyard/issues/14)) ([faab828](https://github.com/lokiwins/switchyard/commit/faab8285e706934ab048cc7ac544b9c39e95014f))


### Bug Fixes

* never title a session with Claude Code's generated "&lt;folder&gt;-&lt;hex&gt;" name ([#11](https://github.com/lokiwins/switchyard/issues/11)) ([b0232f8](https://github.com/lokiwins/switchyard/commit/b0232f8c6bc5440c5891b62bcbed2ecc9b2ac7cf))
* run tests on Node 21+, which reads node --test arguments as globs ([a5a0fa5](https://github.com/lokiwins/switchyard/commit/a5a0fa52cb69f22e173eda129c95acf21cad4cf8))


### Performance

* per-page refresh, git status only where files changed, batched GitHub lookups ([#6](https://github.com/lokiwins/switchyard/issues/6)) ([5e82b6f](https://github.com/lokiwins/switchyard/commit/5e82b6f61adf50ae4f0d449edaeb93cecbc4e57a))
