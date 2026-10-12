# Claude.Mod

[![English](https://img.shields.io/badge/lang-English-lightgrey)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](README.ja.md)

[Claude Code](https://claude.com/claude-code) のターミナル UI を作り変える mod(プラグイン)集です。mod ごとに個別にインストールできます。

| Mod | 内容 |
| --- | --- |
| [statusbar](#statusbar) | プロンプトの上に出る vim 風のステータス帯。model、effort、パス、git、PR、worktree・サブエージェント、使用量ゲージ |
| [filepicker](#filepicker) | `@` メンションを打っている間に開くファイル・フォルダブラウザ。Quick Look でのプレビュー付き |

## 必要なもの

- mod(プラグインのフック)に対応した Claude Code
- ターミナルに [Nerd Font](https://www.nerdfonts.com/) が設定されていること(Powerline と Nerd Font のグリフを使います)
- filepicker の Quick Look プレビューには macOS(それ以外の機能は他の OS でも動きます)
- `git`、PR の表示には [GitHub CLI](https://cli.github.com/)(`gh`)

## インストール

このリポジトリをマーケットプレイスとして追加し、使いたい mod をインストールします。

```sh
claude plugin marketplace add tkhashi/Claude.Mod
claude plugin install statusbar@local-mods
claude plugin install filepicker@local-mods
```

新しいセッションを開くと読み込まれます。更新するときは次のとおりです。

```sh
claude plugin marketplace update local-mods
claude plugin update statusbar@local-mods
claude plugin update filepicker@local-mods
```

## statusbar

プロンプトの上に、角丸のベタ塗りブロックで帯を描きます。

- **1行目**: model(クリックで切替)と effort(クリックで切替)、右側に worktree 一覧・サブエージェント一覧・コンパクト表示のボタン
- **2行目**: 作業ディレクトリ、ブランチ(push 待ち `↑`・pull 待ち `↓`・未コミット `±`)、PR とレビュー状態
- **使用量ゲージ**: 5時間・7日間の上限、コンテキスト、auto-compact を、プロンプト下のヒント行に表示します。ターミナルが細くなると%だけの表示まで縮み、5h・7d は常に見えるようにしています
- **コンパクト表示**: 全部を1行にまとめます。切替ボタンは常に右端です
- Claude の返答とユーザーのプロンプトに、左側の色付きの縦線を付けて見分けやすくします

worktree は、プロジェクト自身の `.claude/worktrees/`(または `.claude/worktree/`)の下にあるものだけを表示します。

## filepicker

プロンプトで `@` を打つと、Claude Code 本体の候補と並んで、帯の上にブラウザが開きます。

- 続けて打つと絞り込みます。`@src/` で `src/` を開き、`@src/ut` で `ut` で始まる・含む項目を出します
- フォルダをクリックすると中に入り、ファイル名をクリックすると `@path` として挿入します。空白を含む名前は `@"My Docs/a.txt"` の形で書き込みます
- ファイルの**アイコン**をクリックすると Quick Look でプレビューします(TOML や `.gitignore` など Quick Look が描けないテキストはプレーンテキストとして開きます)
- クリックできるパンくず、`..` の項目、`..` を含むパスでは実際の場所を表示
- 更新日時順(既定)・名前順・サイズ順のソート、フォルダ・ファイル・拡張子での絞り込み
- 項目の多いフォルダはページ送り。ファイルの種類ごとのアイコンと色は [nvim-web-devicons](https://github.com/nvim-tree/nvim-web-devicons) を利用

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
