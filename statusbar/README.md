# statusbar

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-lightgrey)](README.ja.md)

A [Claude Code](https://claude.com/claude-code) mod that draws a vim-style powerline band of solid, rounded blocks above the prompt.

![statusbar](docs/screenshot.png)

## Features

- **Row 1**: the model (click to switch) and the effort (click to switch), then buttons for the worktree list, the subagent list, and compact mode
- **Row 2**: the working directory, the branch with commits to push `↑`, to pull `↓` and uncommitted files `±`, and the pull request with its review state
- **Usage gauges** for the 5-hour and 7-day limits, the context window and auto-compact sit on the hint line under the prompt. As the terminal narrows they shrink to bare percentages, and 5h/7d always stay in sight (shown in the band when the hint line has no room)
- **Compact mode** puts everything on one row; the switch stays at the right end
- Claude's replies and your prompts get a colored gutter on the left so you can tell them apart

Worktrees are listed only from the project's own `.claude/worktrees/` (or `.claude/worktree/`).

## Requirements

- A [Nerd Font](https://www.nerdfonts.com/) in your terminal
- `git`, and the [GitHub CLI](https://cli.github.com/) (`gh`) for the PR block

## Install

```sh
claude plugin marketplace add tkhashi/Claude.Mods
claude plugin install statusbar@local-mods
```

Start a new session to load it. See the [repository README](../README.md) for updating and development.

## License

[MIT](../LICENSE) © tkhashi. The palette follows [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha (MIT).
