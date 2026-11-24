# Changelog

## [0.4.1](https://github.com/lokiwins/switchyard/compare/v0.4.0...v0.4.1) (2026-11-24)


### Features

* Mark as ▾ on a task's running session closes the task from its work ([#121](https://github.com/lokiwins/switchyard/issues/121)) ([5d1ff89](https://github.com/lokiwins/switchyard/commit/5d1ff89c557d296dee76e7d197f857a478c77bee))

## [0.4.0](https://github.com/lokiwins/switchyard/compare/v0.3.0...v0.4.0) (2026-11-23)


### Notes

* switchyard now needs Node 22.18 or later: the server runs the TypeScript it shares with the pages as it is ([#120](https://github.com/lokiwins/switchyard/issues/120)) ([31b8b10](https://github.com/lokiwins/switchyard/commit/31b8b1042547f32f7146b3a52a8b55e4f9413da4))
* attempts (Start ×N, Compare and Pick) were taken out again before this release; agent orchestration (leads and workers) covers what they were for ([#83](https://github.com/lokiwins/switchyard/issues/83))


### Features

* a lead can check on, message and end its workers ([#88](https://github.com/lokiwins/switchyard/issues/88)) ([7677ed2](https://github.com/lokiwins/switchyard/commit/7677ed2e3e1ad4e0f5ddea25a51ccb291c6ff571))
* a lead's workers listed under it on the Agents page ([#103](https://github.com/lokiwins/switchyard/issues/103)) ([f2ba5f8](https://github.com/lokiwins/switchyard/commit/f2ba5f8391ac52954bf6bd6ba762b9712ecbf5a9))
* a limit on how many agents run at once, refusing with the reason ([#91](https://github.com/lokiwins/switchyard/issues/91)) ([dd2a922](https://github.com/lokiwins/switchyard/commit/dd2a92244d3b04524268be2fc43494b104e54fbd))
* agent providers, with Settings › Agent providers (default, on/off, program, options) ([#77](https://github.com/lokiwins/switchyard/issues/77)) ([fbe8760](https://github.com/lokiwins/switchyard/commit/fbe87607ebd838349a6cfe64382ed65393c18c6e))
* change the terminal colours from the open terminal pane ([#67](https://github.com/lokiwins/switchyard/issues/67)) ([0956961](https://github.com/lokiwins/switchyard/commit/095696170741feb9120cfa1a7bd69d330da22452))
* checks that run by themselves, after a turn or on a commit, without polling ([#82](https://github.com/lokiwins/switchyard/issues/82)) ([c77a902](https://github.com/lokiwins/switchyard/commit/c77a902fc65ab1a2c781130bbf51ae109928d080))
* closing or deleting a task puts its work away, and done tasks can be deleted automatically ([#75](https://github.com/lokiwins/switchyard/issues/75)) ([3aa1fa7](https://github.com/lokiwins/switchyard/commit/3aa1fa79e4cb74c806595bccf7cfb339f17ce522))
* delete ended sessions from the Agents page ([#74](https://github.com/lokiwins/switchyard/issues/74)) ([6b7dea3](https://github.com/lokiwins/switchyard/commit/6b7dea301d26619343018cc61655bba8befdd1e0))
* End ends Claude sessions outside tmux too, leaving their tab open ([#63](https://github.com/lokiwins/switchyard/issues/63)) ([c7a4f56](https://github.com/lokiwins/switchyard/commit/c7a4f560dfd69d1f8a2e0aebe8387554a8c7812e))
* make a task from a session or worktree, linked to its work ([#54](https://github.com/lokiwins/switchyard/issues/54)) ([395a719](https://github.com/lokiwins/switchyard/commit/395a7194bc4aa436f7f273e144f5173f949ff967))
* named checks per repo, written as YAML in Settings › Checks ([#81](https://github.com/lokiwins/switchyard/issues/81)) ([482f6a6](https://github.com/lokiwins/switchyard/commit/482f6a6b352e91ac725b33d645ee7004e406fb08))
* new task windows start at the terminal pane's size ([#73](https://github.com/lokiwins/switchyard/issues/73)) ([e4e8062](https://github.com/lokiwins/switchyard/commit/e4e8062b2cc91a4ed78a686c9661db7dc0205269))
* Review, a read-only second Claude that checks a task's work against its criteria ([#90](https://github.com/lokiwins/switchyard/issues/90)) ([00abfbd](https://github.com/lokiwins/switchyard/commit/00abfbdb9513823ea52ccb475e26ff3c0a9637b5))
* Run check: a per-repo check command, run in a task's worktrees ([#80](https://github.com/lokiwins/switchyard/issues/80)) ([2617df0](https://github.com/lokiwins/switchyard/commit/2617df0a64e6727243afb21e05dd780047bd3817))
* sessions switchyard starts report their turns through hooks ([#108](https://github.com/lokiwins/switchyard/issues/108)) ([4341c28](https://github.com/lokiwins/switchyard/commit/4341c2830d649ff91ea55532ac956067503d3e9a))
* Settings › Workers, how a lead's workers start and whether the lead asks ([#89](https://github.com/lokiwins/switchyard/issues/89)) ([dcfc4ee](https://github.com/lokiwins/switchyard/commit/dcfc4eee08d44d485cb45e21b31029a559219464))
* Start as lead, with switchyard's MCP server to start and list workers ([#87](https://github.com/lokiwins/switchyard/issues/87)) ([136c53b](https://github.com/lokiwins/switchyard/commit/136c53b58249b129f49c45d3596c9ba7cb553c8d))
* stuck and context alerts on running sessions ([#92](https://github.com/lokiwins/switchyard/issues/92)) ([7afd234](https://github.com/lokiwins/switchyard/commit/7afd234556092756328904029100bad643fdc914))
* subtasks, nested under their task and branched from its branch ([#84](https://github.com/lokiwins/switchyard/issues/84)) ([6236534](https://github.com/lokiwins/switchyard/commit/62365344814e701ac54d1d857c186cf4cbdd1c33))
* switchyard's tmux windows run on a server of its own ([#113](https://github.com/lokiwins/switchyard/issues/113)) ([053b459](https://github.com/lokiwins/switchyard/commit/053b459a90c9a3719b08b2bd8b6ce3a32c50e01c))
* terminal colours, chosen in the theme menu and Settings ([#65](https://github.com/lokiwins/switchyard/issues/65)) ([e57620b](https://github.com/lokiwins/switchyard/commit/e57620baf8fdc493946eb08573e141e1bc57af5a))
* the Agents page in React ([#93](https://github.com/lokiwins/switchyard/issues/93)) ([be4506b](https://github.com/lokiwins/switchyard/commit/be4506be5ba654815a73e5b32ae48ebd1e460053))
* the graph page in React; every page is now built from web/ ([#98](https://github.com/lokiwins/switchyard/issues/98)) ([4a59942](https://github.com/lokiwins/switchyard/commit/4a599427a45915d7490749554349033b210f4cb5))
* the Pull requests page in React, on components the pages share ([#94](https://github.com/lokiwins/switchyard/issues/94)) ([a5f6c62](https://github.com/lokiwins/switchyard/commit/a5f6c62096b1c42d5bcec22a3dff7fb90affe245))
* the Settings page in React ([#96](https://github.com/lokiwins/switchyard/issues/96)) ([1412f37](https://github.com/lokiwins/switchyard/commit/1412f3710b632c2b7a930e9fb1065ab70ce90679))
* the Tasks page in React ([#99](https://github.com/lokiwins/switchyard/issues/99)) ([f188455](https://github.com/lokiwins/switchyard/commit/f18845518128754c7ec3d93516444e11ba90279f))
* the Worktrees page in React ([#95](https://github.com/lokiwins/switchyard/issues/95)) ([2dd8b69](https://github.com/lokiwins/switchyard/commit/2dd8b69f1a9da58ba29de123f6a45f0470f9167c))
* themes (Classic, Signal, Ember, Dusk, Graphite), each light and dark ([#64](https://github.com/lokiwins/switchyard/issues/64)) ([74378f5](https://github.com/lokiwins/switchyard/commit/74378f54eb172c25026dcca0f0185fb47db888d7))
* two sunset themes, Coast and Heatwave ([#68](https://github.com/lokiwins/switchyard/issues/68)) ([bc2ce86](https://github.com/lokiwins/switchyard/commit/bc2ce865c218ba61093f68161244b215a4ccb803))


### Bug Fixes

* a branch switch, or a worktree added or removed, shows within seconds ([#61](https://github.com/lokiwins/switchyard/issues/61)) ([f24a427](https://github.com/lokiwins/switchyard/commit/f24a427a77c57f6266d2d4256a953f61c7848adf))
* a lead always uses switchyard's tools without asking ([#104](https://github.com/lokiwins/switchyard/issues/104)) ([014bc6c](https://github.com/lokiwins/switchyard/commit/014bc6ced6568673c22da9c6e3c34bbdbbb82ffd))
* a lead looks at its workers without asking; its tools are allowed by default ([#102](https://github.com/lokiwins/switchyard/issues/102)) ([6188c4f](https://github.com/lokiwins/switchyard/commit/6188c4f2229fd59ac85f0ee40e7d17926e55a48d))
* a lead's ended workers stay under it; an ended worker reads Ended ([#106](https://github.com/lokiwins/switchyard/issues/106)) ([bbe1690](https://github.com/lokiwins/switchyard/commit/bbe169084b4802d59d867536ba730638f9c22459))
* a select's arrow sits inset from its right edge ([#105](https://github.com/lokiwins/switchyard/issues/105)) ([6040a45](https://github.com/lokiwins/switchyard/commit/6040a4514f9fc7efa56a0813876c7eb58bffdb7c))
* a started task keeps its worktree when Claude switches it to another branch ([#56](https://github.com/lokiwins/switchyard/issues/56)) ([7f5cf5c](https://github.com/lokiwins/switchyard/commit/7f5cf5c54ed640400d6fd7fb2d7041cf27afe8d5))
* closing or deleting a task shows at once ([#76](https://github.com/lokiwins/switchyard/issues/76)) ([d8d1e2f](https://github.com/lokiwins/switchyard/commit/d8d1e2f48eab242fb0b9cc36d04452b670999e07))
* every theme's text meets WCAG AA contrast; dark-mode menus are raised by light, not shadow ([#66](https://github.com/lokiwins/switchyard/issues/66)) ([8f7cbcf](https://github.com/lokiwins/switchyard/commit/8f7cbcf64f5b76b89cbb21190f99d9a4297bea2e))
* how a session ended is read past a compaction's re-attached files ([#107](https://github.com/lokiwins/switchyard/issues/107)) ([1e4b0a6](https://github.com/lokiwins/switchyard/commit/1e4b0a6f7f302a8f45c945862c4ba567290972ff))
* opening a terminal leaves the other task windows their size ([#71](https://github.com/lokiwins/switchyard/issues/71)) ([85767ea](https://github.com/lokiwins/switchyard/commit/85767ea5f4bfb38d969eb1327917428bb25fd5b2))
* Resume a running session switchyard can't reach ([#112](https://github.com/lokiwins/switchyard/issues/112)) ([9b92842](https://github.com/lokiwins/switchyard/commit/9b92842108c5f2d47685fdcc58e63dda0bb01c3e))
* the Agents and PRs pages keep what didn't change instead of rebuilding their lists ([#86](https://github.com/lokiwins/switchyard/issues/86)) ([9fbe7f9](https://github.com/lokiwins/switchyard/commit/9fbe7f94d3bbe3cb01c5151f62f65ae9b6982fb2))
* the live terminal opens at its pane's size and follows a resize without looking squashed ([#70](https://github.com/lokiwins/switchyard/issues/70)) ([74502b3](https://github.com/lokiwins/switchyard/commit/74502b34f047a3bc2e4806563c0fde81e942db87))
* the pull requests page shows changes made on GitHub within seconds ([#72](https://github.com/lokiwins/switchyard/issues/72)) ([a80b7a9](https://github.com/lokiwins/switchyard/commit/a80b7a9bb738a44f8fe5521a8c781c75de4dac00))
* the Tasks page keeps what didn't change instead of rebuilding every row ([#85](https://github.com/lokiwins/switchyard/issues/85)) ([dec4687](https://github.com/lokiwins/switchyard/commit/dec4687053935cb0889e868c2977d750e1baa003))


### Performance

* read each repo's branches only when its refs change, not on every rebuild ([#60](https://github.com/lokiwins/switchyard/issues/60)) ([bd5c23b](https://github.com/lokiwins/switchyard/commit/bd5c23b4c818a05c5c639e4bf8ecf8eb2bcdfb2d))
* reuse the gh login and assigned-issues list, so Tasks and Settings stop waiting on gh ([#57](https://github.com/lokiwins/switchyard/issues/57)) ([4690707](https://github.com/lokiwins/switchyard/commit/46907076a9090c2ea06e4acc005118cf68e19641))
* stop looking through every repo each minute, and re-checking session start times each build ([#62](https://github.com/lokiwins/switchyard/issues/62)) ([da266b3](https://github.com/lokiwins/switchyard/commit/da266b3e43e6956052b5168827b795a34717c310))
* the live terminal opens without a stutter ([#69](https://github.com/lokiwins/switchyard/issues/69)) ([36ac324](https://github.com/lokiwins/switchyard/commit/36ac324e89d8366fe350b43f177dc2261c7133bb))
* the Worktrees page leaves its list alone when a poll finds nothing changed ([#58](https://github.com/lokiwins/switchyard/issues/58)) ([de6f4b4](https://github.com/lokiwins/switchyard/commit/de6f4b4556f9fe91ddc46ae30d47ae02e68785ca))
* the Worktrees page redraws only the rows that changed ([#59](https://github.com/lokiwins/switchyard/issues/59)) ([cff034d](https://github.com/lokiwins/switchyard/commit/cff034decc7d25e5be8e05c1a816c2d374565357))

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
