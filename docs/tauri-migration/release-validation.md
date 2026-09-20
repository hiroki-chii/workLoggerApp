# Phase 8 配布検証

## 実施済み

| 項目 | 結果 | 根拠 |
|---|---|---|
| Tauri command の読み書き | 成功 | Rust の DB 互換テストと Desktop API command 契約テスト |
| 新規 DB | 成功 | `WORKLOGGER_DATA_DIR` を隔離して配布用 exe を起動し、`logs.db` を生成 |
| NSIS 生成 | 成功 | `src-tauri/target/release/bundle/nsis/ゆとリズム_1.0.0_x64-setup.exe` |
| 新規インストール | 成功 | 隔離先に `workloggerapp.exe`、`monitor.ps1`、`uninstall.exe` を配置 |
| インストール済み exe の起動 | 成功 | 隔離 DB を生成するまで起動を確認 |
| アンインストール | 成功 | NSIS の `uninstall.exe /S` 実行後にアプリ実行ファイルが削除されることを確認 |

## 実機観測

ポータブル版で次を確認した。

- 起動速度が Electron 版より大幅に向上した。
- 常駐時 CPU 使用率は 1% 未満だった。
- メモリ使用量は 6 MB 未満だった。

数値は実機の観測値であり、画面構成、監視頻度、WebView2 Runtime、Windows の状態によって変動する。

Tauri 版と Electron 版はどちらも `%APPDATA%\\workloggerapp\\logs.db` を利用する。新規 DB の smoke test では `WORKLOGGER_DATA_DIR` を使い、実データを変更していない。

## 配布前の手動確認

- 既存 Electron 版を終了し、Tauri インストーラーを実データのある Windows 環境へ導入する。
- 既存の履歴、設定、ポモドーロ、ルール、mini window の位置を確認する。
- Tray、二重起動、スリープ復帰、Critical/ポモドーロ通知を含めて通常の一日分を常駐させる。
- アンインストール後も `%APPDATA%\\workloggerapp\\logs.db` が残り、再インストール時に読み込めることを確認する。

## Electron 削除の判断

自動化済みの配布試験は完了したが、一日常駐と実データの手動確認はこの作業環境では代替できない。完了後に `electron-core/`、Express backend、Better-SQLite3、Electron 依存、旧テストを削除する。
