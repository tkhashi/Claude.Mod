# Claude.Mod

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-lightgrey)](README.ja.md)

Mods (plugins) for [Claude Code](https://claude.com/claude-code) that reshape its terminal UI. Each mod installs on its own.

| Mod | What it does |
| --- | --- |
| [statusbar](statusbar/README.md) | A vim-style powerline band above the prompt: model, effort, path, git, PR, worktrees and subagents, plus usage gauges |
| [filepicker](filepicker/README.md) | A file and folder browser that opens while you type an `@` mention, with Quick Look preview |

See each mod's README for its features and requirements.

| statusbar | filepicker |
| --- | --- |
| ![statusbar](statusbar/docs/screenshot.png) | ![filepicker](filepicker/docs/screenshot.png) |

## Install

Add this repository as a marketplace, then install the mods you want:

```sh
claude plugin marketplace add tkhashi/Claude.Mod
claude plugin install statusbar@local-mods
claude plugin install filepicker@local-mods
```

Start a new session to load them. To update later:

```sh
claude plugin marketplace update local-mods
claude plugin update statusbar@local-mods
claude plugin update filepicker@local-mods
```

Both mods need Claude Code with mod (plugin hooks) support and a [Nerd Font](https://www.nerdfonts.com/) in your terminal.

## Development

The source of truth is this repository. To work on it locally, point the `local-mods` marketplace at your clone (for example by symlinking `~/.claude/local-mods` to it), then:

```sh
cd statusbar   # or filepicker
claude plugin validate .
claude plugin test .
```

`.claude-plugin/types/` holds generated type definitions and is not committed.

## License

[MIT](LICENSE) © tkhashi

### Third-party notices

- `filepicker/hooks/devicons.ts` is generated from [nvim-web-devicons](https://github.com/nvim-tree/nvim-web-devicons), MIT License, Copyright (c) 2023 nvim-tree. See [`filepicker/LICENSE.nvim-web-devicons`](filepicker/LICENSE.nvim-web-devicons).
- The color palette follows [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha (MIT).
- Icons are drawn from your installed [Nerd Font](https://www.nerdfonts.com/); no font files are distributed here.
