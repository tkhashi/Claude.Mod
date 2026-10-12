# Claude.Mods

[![English](https://img.shields.io/badge/lang-English-lightgrey)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](README.ja.md)

[Claude Code](https://claude.com/claude-code) のターミナル UI を作り変える mod(プラグイン)集です。mod ごとに個別にインストールできます。

| Mod | 内容 |
| --- | --- |
| [statusbar](statusbar/README.ja.md) | プロンプトの上に出る vim 風のステータス帯。model、effort、パス、git、PR、worktree・サブエージェント、使用量ゲージ |
| [filepicker](filepicker/README.ja.md) | `@` メンションを打っている間に開くファイル・フォルダブラウザ。Quick Look でのプレビュー付き |

機能や必要なものは、各 mod の README を参照してください。

| statusbar | filepicker |
| --- | --- |
| ![statusbar](statusbar/docs/screenshot.png) | ![filepicker](filepicker/docs/screenshot.png) |

## インストール

このリポジトリをマーケットプレイスとして追加し、使いたい mod をインストールします。

```sh
claude plugin marketplace add tkhashi/Claude.Mods
claude plugin install statusbar@local-mods
claude plugin install filepicker@local-mods
```

新しいセッションを開くと読み込まれます。更新するときは次のとおりです。

```sh
claude plugin marketplace update local-mods
claude plugin update statusbar@local-mods
claude plugin update filepicker@local-mods
```

どちらの mod も、mod(プラグインのフック)に対応した Claude Code と、ターミナルに設定された [Nerd Font](https://www.nerdfonts.com/) が必要です。

## 開発

このリポジトリが正となるソースです。手元で開発するときは、マーケットプレイス `local-mods` をクローンしたフォルダに向けます(例: `~/.claude/local-mods` をクローンへのシンボリックリンクにする)。そのうえで次を実行します。

```sh
cd statusbar   # または filepicker
claude plugin validate .
claude plugin test .
```

`.claude-plugin/types/` は自動生成される型定義なので、コミットしていません。

## ライセンス

[MIT](LICENSE) © tkhashi

### 第三者の著作物

- `filepicker/hooks/devicons.ts` は [nvim-web-devicons](https://github.com/nvim-tree/nvim-web-devicons)(MIT License、Copyright (c) 2023 nvim-tree)から生成しています。ライセンスは [`filepicker/LICENSE.nvim-web-devicons`](filepicker/LICENSE.nvim-web-devicons) を参照してください。
- 配色は [Catppuccin](https://github.com/catppuccin/catppuccin) Mocha(MIT)に沿っています。
- アイコンはインストール済みの [Nerd Font](https://www.nerdfonts.com/) で描画します。このリポジトリではフォントファイルを配布していません。
