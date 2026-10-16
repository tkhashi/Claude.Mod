# Claude.Mods

[![English](https://img.shields.io/badge/lang-English-lightgrey)](README.md)
[![日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](README.ja.md)

[Claude Code](https://claude.com/claude-code) のターミナル UI を作り変える mod(プラグイン)集です。mod ごとに個別にインストールできます。

| Mod | 内容 |
| --- | --- |
| [statusbar-buttons](statusbar-buttons/README.ja.md) | model・effort・worktree・サブエージェントのボタンを、プロンプト下のヒント行の右端に、つながったブロックで出す。パス・git・PR・使用量ゲージを Claude Code 本体のステータスラインに出す [statusline](statusbar-buttons/statusline/README.ja.md) コマンドと組み合わせて使う |
| [filepicker](filepicker/README.ja.md) | `@` メンションを打っている間に開くファイル・フォルダブラウザ。Quick Look でのプレビュー付き |
| [peek](peek/README.ja.md) | プロンプトと Claude の発言を縦線と背景で色分けし、トランスクリプトのツール呼び出しを1行ずつに畳み(結果は隠す)、会話をペインで1ページずつ表示する。プロンプトの下に、Claude の発言から次の発言までの thinking・ツール呼び出しを並べ、各呼び出しの入力と結果は呼び出しごとに表示と非表示を切り替えられる。前後のページへはボタンで移れる。トランスクリプトは、何も畳まない・ツール呼び出しを1行に畳む・ツール呼び出しを除く・プロンプトと最後の発言だけ、の4段階で表示を切り替えられる |

機能や必要なものは、各 mod の README を参照してください。

| statusbar-buttons |
| --- |
| ![statusbar-buttons](statusbar-buttons/docs/screenshot.png) |

| filepicker | peek |
| --- | --- |
| ![filepicker](filepicker/docs/screenshot.png) | ![peek](peek/docs/screenshot.png) |

## インストール

このリポジトリをマーケットプレイスとして追加し、使いたい mod をインストールします。

```sh
claude plugin marketplace add tkhashi/Claude.Mods
claude plugin install statusbar-buttons@local-mods
claude plugin install filepicker@local-mods
claude plugin install peek@local-mods
```

新しいセッションを開くと読み込まれます。更新するときは次のとおりです。

```sh
claude plugin marketplace update local-mods
claude plugin update statusbar-buttons@local-mods
claude plugin update filepicker@local-mods
claude plugin update peek@local-mods
```

どの mod も、mod(プラグインのフック)に対応した Claude Code と、ターミナルに設定された [Nerd Font](https://www.nerdfonts.com/) が必要です。

## 開発

このリポジトリが正となるソースです。手元で開発するときは、マーケットプレイス `local-mods` をクローンしたフォルダに向けます(例: `~/.claude/local-mods` をクローンへのシンボリックリンクにする)。そのうえで次を実行します。

```sh
cd statusbar-buttons   # または filepicker、peek
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
