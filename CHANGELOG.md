# Changelog

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
