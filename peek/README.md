# peek

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-lightgrey)](README.ja.md)

A [Claude Code](https://claude.com/claude-code) mod in two parts. In the transcript, each tool call folds to one line and its result block is hidden, so a Write or an Edit no longer spills its file or diff into the conversation. In a pane, the conversation reads a page at a time: under your prompt, what Claude did between two of its messages (thinking, each tool call's input and result shown or folded at a press), the pages before and after a press away, all without switching to the ctrl+o transcript.

![peek](docs/screenshot.png)

## Features

- **Folded tool lines**: each tool call in the transcript is one line, `● Write(…/src/app.ts)`, its dot yellow while the call runs, green once it is done and red when it failed, with a note such as `error`, `interrupted` or `background` after it. A long path is cut from the front so the file name stays
- A shell command keeps only its command names and what joins them, its arguments shown as `..`: `● Bash(cd .. && npm .. | tail ..)`. Quotes, `$(…)`, heredoc bodies and comments are skipped
- The engine's own grouped lines (`Read 3 files, ran 2 shell commands`) unfold, so every call gets its own line
- Claude's messages between tool calls (those a tool call followed) draw on a gray background, so they don't read as Claude's reply. Where another mod draws the messages itself (statusbar does), the background is that mod's
- The summary rows the engine writes in place of Claude's text between tool calls are drawn as a gray band with a blank line above and below, so they don't read as Claude's reply
- A click on any of those lines opens the page that holds it: from Claude's message before it to the one after, its prompt on top, the call's input and result unfolded and scrolled into view; a second click on the same line closes it
- **A page**: the prompt of its turn (a long one shows its first lines until pressed), Claude's message before the steps, the steps in order (thinking dimmed, tool calls), and Claude's message after them. The messages are colored as in the transcript under statusbar: the prompt with a sky-blue gutter on a blue-gray band, Claude's messages with an orange gutter, the turn's last one on a faint orange band and those along the way on gray. A turn's first page starts at the prompt; a turn still running ends on a page with no message after it yet
- `◂` / `▸` in the header, or `◂ previous` / `next ▸` under the page, go to the page before or after, across turns; the header says where you are, `Turn 3/12 · page 2/4`
- Each tool call shows as its header line alone, `● Edit …/src/app.ts  ▸ input  ▸ 12 lines`, on a tinted band. `▸ input` unfolds the input as JSON and `▸ 12 lines` the result, each on a background of its own (a failed result's tinted red); a click on the header line unfolds or folds both. The colors follow a light or dark theme
- Scroll with the wheel or the arrows. On the latest page it moves on to each new page as the turn runs, and, scrolled to the bottom, follows the page as it grows; on an earlier page it stays where you are reading. `⇥` goes back to the latest page and follows again; `⟳` reads the conversation again; `✕ close` (wider than the frame's own `✕`, red under the pointer) closes the pane
- Rows of a subagent's transcript open that agent's conversation
- **Where it draws** is Claude Code's call, by the width of the terminal: docked beside the transcript in the fullscreen layout from 110 columns, with longer results; narrower, or on the main screen, above the prompt, results cut to a few lines. Narrow, the header shortens to `3·2/4`
- Keyboard: `/peek` opens the latest page (or closes it). While the pane has the keys, Tab walks the buttons and Enter presses one; `p` and `n` go to the page before and after, `e` jumps to the latest, `r` reloads, the arrows scroll, and `x` or `Esc` closes it

## Notes

- Clicks reach mods only in the fullscreen layout. On the main screen (`CLAUDE_CODE_NO_FLICKER=0`, tmux by default) use `/peek` and the keys above
- The conversation is read as the model sees it; the reminders Claude Code adds to it are left out, and a slash command shows as `/name args` without its output
- Thinking shows only as far as the API returned it; omitted or redacted thinking is marked as such
- A line whose call is not in the conversation yet or any more (compacted) shows what the line itself holds
- Under ctrl+o or `--verbose` the rows are left to Claude Code, results and all
- [tool-lines](https://github.com/Tickloop/claude-mods) folds tool calls too; install one or the other

## Requirements

- A [Nerd Font](https://www.nerdfonts.com/) in your terminal

## Install

```sh
claude plugin marketplace add tkhashi/Claude.Mods
claude plugin install peek@local-mods
```

Start a new session to load it. See the [repository README](../README.md) for updating and development.

## License

[MIT](../LICENSE) © tkhashi.
