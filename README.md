# Claude.Mod

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-lightgrey)](README.ja.md)

Mods (plugins) for [Claude Code](https://claude.com/claude-code) that reshape its terminal UI. Each mod installs on its own.

| Mod | What it does |
| --- | --- |
| [statusbar](#statusbar) | A vim-style powerline band above the prompt: model, effort, path, git, PR, worktrees and subagents, plus usage gauges |
| [filepicker](#filepicker) | A file and folder browser that opens while you type an `@` mention, with Quick Look preview |

## Requirements

- Claude Code with mod (plugin hooks) support
- A [Nerd Font](https://www.nerdfonts.com/) in your terminal; the mods draw Powerline and Nerd Font glyphs
- macOS for filepicker's Quick Look preview (everything else works on other platforms)
- `git` and, for the PR block, the [GitHub CLI](https://cli.github.com/) (`gh`)

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

## statusbar

A band of solid, rounded blocks above the prompt.

- **Row 1**: the model (click to switch) and the effort (click to switch), then buttons for the worktree list, the subagent list, and compact mode
- **Row 2**: the working directory, the branch with commits to push `↑`, to pull `↓` and uncommitted files `±`, and the pull request with its review state
- **Usage gauges** for the 5-hour and 7-day limits, the context window and auto-compact sit on the hint line under the prompt. As the terminal narrows they shrink to bare percentages, and 5h/7d always stay in sight
- **Compact mode** puts everything on one row; the switch stays at the right end
- Claude's replies and your prompts get a colored gutter on the left so you can tell them apart

Worktrees are listed only from the project's own `.claude/worktrees/` (or `.claude/worktree/`).

## filepicker

Type `@` in the prompt and a browser opens above the band, alongside Claude Code's own suggestions.

- Typing narrows it: `@src/` opens `src/`, `@src/ut` lists entries starting with or containing `ut`
- Click a folder to open it, a file's name to insert it as `@path`; names with spaces are written as `@"My Docs/a.txt"`
- Click a file's **icon** to preview it in Quick Look (text files Quick Look cannot draw, such as TOML or `.gitignore`, open as plain text)
- Clickable breadcrumbs, a `..` entry, and the real location shown for paths through `..`
- Sort by modified time (default), name or size; filter by folders, files or extension
- Paging for large folders; icons and colors per file type from [nvim-web-devicons](https://github.com/nvim-tree/nvim-web-devicons)

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
