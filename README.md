# Claude.Mods

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-lightgrey)](README.ja.md)

Mods (plugins) for [Claude Code](https://claude.com/claude-code) that reshape its terminal UI. Each mod installs on its own.

| Mod | What it does |
| --- | --- |
| [statusbar](statusbar/README.md) | A vim-style powerline band above the prompt: model, effort, path, git, PR, worktrees and subagents, plus usage gauges |
| [filepicker](filepicker/README.md) | A file and folder browser that opens while you type an `@` mention, with Quick Look preview |
| [peek](peek/README.md) | Colors your prompts and Claude's messages with a gutter, folds each tool call in the transcript to one line (results hidden), and shows the conversation in a pane a page at a time: under your prompt, the thinking and tool calls between two of Claude's messages, each call's input and result shown or folded per call, the other pages a press away. The transcript has three levels: everything, without the tool lines, or your prompts and Claude's answers alone |

See each mod's README for its features and requirements.

| statusbar | filepicker |
| --- | --- |
| ![statusbar](statusbar/docs/screenshot.png) | ![filepicker](filepicker/docs/screenshot.png) |

| peek |
| --- |
| ![peek](peek/docs/screenshot.png) |

## Install

Add this repository as a marketplace, then install the mods you want:

```sh
claude plugin marketplace add tkhashi/Claude.Mods
claude plugin install statusbar@local-mods
claude plugin install filepicker@local-mods
claude plugin install peek@local-mods
```

Start a new session to load them. To update later:

```sh
claude plugin marketplace update local-mods
claude plugin update statusbar@local-mods
claude plugin update filepicker@local-mods
claude plugin update peek@local-mods
```

All mods need Claude Code with mod (plugin hooks) support and a [Nerd Font](https://www.nerdfonts.com/) in your terminal.

## Development

The source of truth is this repository. To work on it locally, point the `local-mods` marketplace at your clone (for example by symlinking `~/.claude/local-mods` to it), then:

```sh
cd statusbar   # or filepicker, peek
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
