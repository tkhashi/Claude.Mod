# filepicker

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-lightgrey)](README.ja.md)

A [Claude Code](https://claude.com/claude-code) mod: type `@` in the prompt and a file and folder browser opens above the band, alongside Claude Code's own suggestions.

![filepicker](docs/screenshot.png)

## Features

- Typing narrows it: `@src/` opens `src/`, `@src/ut` lists entries starting with or containing `ut`
- Click a folder to open it, a file's name to insert it as `@path`; names with spaces are written as `@"My Docs/a.txt"`
- Click a file's **icon** to preview it in Quick Look; click it again, or anywhere else in the picker, to close the preview. Text Quick Look cannot show (TOML, `.gitignore`, extensionless files) opens as plain text
- A **Preview** switch makes a plain click on a file's name preview it too
- Clickable breadcrumbs, a `..` entry, and the real location shown for paths through `..`
- Sort by modified time (default), name or size; filter by folders, files or extension
- Paging for large folders; icons and colors per file type from [nvim-web-devicons](https://github.com/nvim-tree/nvim-web-devicons)
- Once the list is clicked: arrows move, Return picks, Space previews

## Requirements

- A [Nerd Font](https://www.nerdfonts.com/) in your terminal
- macOS for the Quick Look preview (the browser itself works elsewhere). The first preview may ask to let your terminal control System Events, which brings Quick Look to the front

## Install

```sh
claude plugin marketplace add tkhashi/Claude.Mods
claude plugin install filepicker@local-mods
```

Start a new session to load it. See the [repository README](../README.md) for updating and development.

## License

[MIT](../LICENSE) © tkhashi.

`hooks/devicons.ts` is generated from [nvim-web-devicons](https://github.com/nvim-tree/nvim-web-devicons), MIT License, Copyright (c) 2023 nvim-tree; see [`LICENSE.nvim-web-devicons`](LICENSE.nvim-web-devicons). Icons are drawn from your installed Nerd Font; no font files are distributed here.
