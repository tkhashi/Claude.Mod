# statusbar

[![English](https://img.shields.io/badge/lang-English-lightgrey)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](README.ja.md)

プロンプトの上に、角丸のベタ塗りブロックで vim 風のステータス帯を描く [Claude Code](https://claude.com/claude-code) の mod です。

![statusbar](docs/screenshot.png)

## 機能

- **1行目**: model(クリックで切替)と effort(クリックで切替)、右側に worktree 一覧・サブエージェント一覧・コンパクト表示のボタン
- **2行目**: 作業ディレクトリ、ブランチ(push 待ち `↑`・pull 待ち `↓`・未コミット `±`)、PR とレビュー状態
- **使用量ゲージ**: 5時間・7日間の上限、コンテキスト、auto-compact を、プロンプト下のヒント行に表示します。ターミナルが細くなると%だけの表示まで縮み、5h・7d は常に見えるようにしています(ヒント行に入らないときは帯に表示)
- **コンパクト表示**: 全部を1行にまとめます。切替ボタンは常に右端です
- Claude の返答とユーザーのプロンプトに、左側の色付きの縦線を付けて見分けやすくします

worktree は、プロジェクト自身の `.claude/worktrees/`(または `.claude/worktree/`)の下にあるものだけを表示します。

## 必要なもの

- ターミナルに [Nerd Font](https://www.nerdfonts.com/) が設定されていること
- `git`、PR の表示には [GitHub CLI](https://cli.github.com/)(`gh`)

## インストール

```sh
claude plugin marketplace add tkhashi/Claude.Mod
claude plugin install statusbar@local-mods
```

新しいセッションを開くと読み込まれます。更新方法や開発については[リポジトリの README](../README.ja.md) を参照してください。

## ライセンス

[MIT](../LICENSE) © tkhashi。配色は [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha(MIT)に沿っています。
