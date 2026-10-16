# statusbar-buttons

[![English](https://img.shields.io/badge/lang-English-lightgrey)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](README.ja.md)

[statusbar](../statusbar/README.ja.md) mod の押せる部分だけを切り出し、Claude Code 本体のステータスラインの隣に置く mod です。表示専用の部分(パス・git・PR・使用量ゲージ)は [statusline](statusline/README.ja.md) コマンドが受け持ちます。

![statusbar-buttons](docs/screenshot.png)

## 機能

プロンプト下のヒント行の右端、[statusline](statusline/README.ja.md) の行のすぐ下に、statusbar と同じ powerline 風のつながったブロック(`( a( b( c |`、右端は平ら)で並びます。ヒント行の左側には Claude Code 本体の文言(`auto mode on` など)が残ります。

- **model**(クリックで切替)と **effort**(クリックで切替)
- **worktree** 一覧と**サブエージェント**一覧のボタン

選択肢や一覧はプロンプトの上に、同時に1つだけ開きます。ターミナルが細くなるとブロックが縮みます。model はコンテキストサイズ付きの名前、名前だけ、頭文字とバージョンの順で、いちばん狭いときは2つの一覧ボタンを外します。

mod 自身が行を描かなくなったので、コンパクト表示はありません。

worktree は、プロジェクト自身の `.claude/worktrees/`(または `.claude/worktree/`)の下にあるものだけを表示します。

## 必要なもの

- ターミナルに [Nerd Font](https://www.nerdfonts.com/) が設定されていること
- `git`
- [statusline](statusline/README.ja.md) コマンドも設定してください。同じボタンを描く statusbar mod とは併用しないでください。

## インストール

```sh
claude plugin marketplace add tkhashi/Claude.Mods
claude plugin install statusbar-buttons@local-mods
```

新しいセッションを始めると読み込まれます。

## ライセンス

[MIT](../LICENSE) © tkhashi。配色は [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha(MIT)に従います。
