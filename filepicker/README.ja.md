# filepicker

[![English](https://img.shields.io/badge/lang-English-lightgrey)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](README.ja.md)

プロンプトで `@` を打つと、Claude Code 本体の候補と並んで、帯の上にファイル・フォルダのブラウザが開く [Claude Code](https://claude.com/claude-code) の mod です。

![filepicker](docs/screenshot.png)

## 機能

- 続けて打つと絞り込みます。`@src/` で `src/` を開き、`@src/ut` で `ut` で始まる・含む項目を出します
- フォルダをクリックすると中に入り、ファイル名をクリックすると `@path` として挿入します。空白を含む名前は `@"My Docs/a.txt"` の形で書き込みます
- ファイルの**アイコン**をクリックすると Quick Look でプレビューします。もう一度クリックするか、ピッカー内の他の場所をクリックすると閉じます。Quick Look が表示できないテキスト(TOML、`.gitignore`、拡張子の無いファイル)はプレーンテキストとして開きます
- **Preview** の切替をオンにすると、ファイル名の普通のクリックでもプレビューします
- クリックできるパンくず、`..` の項目、`..` を含むパスでは実際の場所を表示
- 更新日時順(既定)・名前順・サイズ順のソート、フォルダ・ファイル・拡張子での絞り込み
- 項目の多いフォルダはページ送り。ファイルの種類ごとのアイコンと色は [nvim-web-devicons](https://github.com/nvim-tree/nvim-web-devicons) を利用
- 一覧をクリックした後は、矢印で移動、Return で選択、Space でプレビュー

## 必要なもの

- ターミナルに [Nerd Font](https://www.nerdfonts.com/) が設定されていること
- Quick Look でのプレビューには macOS(ブラウザ自体は他の OS でも動きます)。初回のプレビューで、ターミナルに System Events の操作を許可するか尋ねられることがあります(Quick Look を前面に出すために使います)

## インストール

```sh
claude plugin marketplace add tkhashi/Claude.Mods
claude plugin install filepicker@local-mods
```

新しいセッションを開くと読み込まれます。更新方法や開発については[リポジトリの README](../README.ja.md) を参照してください。

## ライセンス

[MIT](../LICENSE) © tkhashi。

`hooks/devicons.ts` は [nvim-web-devicons](https://github.com/nvim-tree/nvim-web-devicons)(MIT License、Copyright (c) 2023 nvim-tree)から生成しています。ライセンスは [`LICENSE.nvim-web-devicons`](LICENSE.nvim-web-devicons) を参照してください。アイコンはインストール済みの Nerd Font で描画し、このリポジトリではフォントファイルを配布していません。
