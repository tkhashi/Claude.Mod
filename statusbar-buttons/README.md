# statusbar-buttons

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-lightgrey)](README.ja.md)

Clickable buttons that sit beside Claude Code's own status line. The read-only half (path, git, PR, usage gauges) is the [statusline](statusline/README.md) command.

![statusbar-buttons](docs/screenshot.png)

## Features

At the right end of the hint line under the prompt, right below the [statusline](statusline/README.md) rows, as joined powerline blocks (`( a( b( c |`, flat at the right end). The hint line keeps Claude Code's own text (`auto mode on`) on the left:

- **Model** (click to switch) and **effort** (click to switch)
- Buttons for the **worktree** list and the **subagent** list

A picker or a list opens above the prompt, one at a time. The blocks shrink as the terminal narrows: the model goes from its name with context size, to its name, to its initial and version, and at the narrowest the two list buttons drop out.

There is no compact mode here, since the mod no longer draws rows of its own.

Worktrees are listed only from the project's own `.claude/worktrees/` (or `.claude/worktree/`).

## Requirements

- A [Nerd Font](https://www.nerdfonts.com/) in your terminal
- `git`
- Set up the [statusline](statusline/README.md) command too

## Install

```sh
claude plugin marketplace add tkhashi/Claude.Mods
claude plugin install statusbar-buttons@local-mods
```

Start a new session to load it.

## License

[MIT](../LICENSE) © tkhashi. The palette follows [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha (MIT).
