# statusline

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-lightgrey)](README.ja.md)

A command for Claude Code's own [status line](https://code.claude.com/docs/en/statusline) that draws the read-only half of the [statusbar](../../statusbar/README.md) mod in the look of the old `statusline-command.sh`: an orange label followed by the value, for the working directory, git and PR as well as the usage indicators. The directory and the branch take a Nerd Font icon in place of a label. The clickable half (model, effort, worktrees, subagents) is the [statusbar-buttons](../README.md) mod.

## What it shows

- The working directory, the branch with commits to push `↑`, to pull `↓` and uncommitted files `±` (✓ when clean), and the pull request number (a link, colored by review state): ` ~/work   main ±3  pr:#9`
- Usage indicators for the 5-hour and 7-day limits, the context window and auto-compact, in that order, as an orange label and a six-cell bar: `5h:[███░░░] 41% 7d:[█████░] 85% ctx:[░░░░░░] 12%`. The bar takes its own color, yellow from 50% and red from 80%
- It reads the terminal width from `COLUMNS`. The indicators sit below the working directory row with a blank row between; when narrow they drop the bars to bare percentages (`ctx:12%`) and finally wrap

The pull request title is not shown: the status line input carries the number, URL and review state, but not the title.

## Requirements

- Node.js 22.18 or later (it runs the TypeScript file directly), and `git`
- A [Nerd Font](https://www.nerdfonts.com/) in your terminal

## Setup

Link it from `~/.claude` so that the global path is an alias and the real file stays in this repository, then point the status line at the link in `~/.claude/settings.json`:

```sh
ln -sfn /path/to/Claude.Mods/statusbar-buttons/statusline/statusline.ts ~/.claude/statusline.ts
```

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline.ts"
  }
}
```

The line is redrawn on each new message, not on a terminal resize. To make it follow the width, add `"refreshInterval": 2`.

## Test

```sh
node --test statusline.spec.ts
```

## License

[MIT](../../LICENSE) © tkhashi. The palette follows [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha (MIT).
