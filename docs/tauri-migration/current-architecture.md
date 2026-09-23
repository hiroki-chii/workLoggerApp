# 移行前のアーキテクチャ（Electron 版）

Tauri 移行前の実装を記録した履歴資料。現在のアーキテクチャを示すものではなく、移行時に維持した互換挙動の根拠として保管する。

```text
React/Vite renderer (main window, mini window)
    | HTTP: http://127.0.0.1:3001/api
    | Electron IPC: window.require('electron')
    v
Electron Main
    | fork/spawn
    +--> Express + Better-SQLite3 server
    |        +--> notification timer
    |
    +--> collector process
             +--> persistent PowerShell monitor
                    +--> Win32 API
```

## プロセスと責務

| 層 | 現在の実装 | 責務 |
|---|---|---|
| UI | `frontend/src/` | ダッシュボード、履歴、タイムテーブル、設定、CSV 操作、ミニ画面、ポモドーロ表示 |
| Electron Main | `electron-core/main.js` | ウィンドウ、Tray、単一起動、子プロセス、休止・復帰、ネイティブダイアログ |
| API | `backend/server.js` | SQLite 初期化、HTTP API、集計、設定、ポモドーロ、通知タイマー、CSV |
| Collector | `backend/collector.js` | サンプル周期、PowerShell の常駐プロセス管理、活動ログの記録、idle 状態の HTTP 更新 |
| Monitor | `backend/monitor.ps1` | 前面ウィンドウと無操作時間の取得 |

## 起動・終了・電源状態

- DB は `%APPDATA%\\workloggerapp\\logs.db`。`WORKLOGGER_DATA_DIR` があればそのディレクトリを使用する。
- Electron は単一起動ロックを取得してから Main Window、Tray、Express、Collector を起動する。
- Collector は API の ready メッセージ後に自動開始する。記録の開始・停止も UI から変更できる。
- Main Window の close はアプリを終了せず非表示にする。`show_mini_on_close=true` ならミニ画面を出す。
- Tray の「終了」または UI の完全終了は Collector と API を停止してアプリを終了する。
- suspend で Collector を止め、resume で必要なら再開して renderer に同期を通知する。

## 疲労・ポモドーロの現行仕様

- `current_mode=tracking` のとき、`logs` の活動サンプル数を `sliding_window_size` 分の期待サンプル数と比較する。
- 初期既定値はサンプル間隔 10 秒、スライディングウィンドウ 90 分。無操作時間が 60 秒以上ならログは記録しない。
- idle rate の閾値は `>=40 Restored`、`>=25 Calm`、`>=15 Focused`、`>=10 Strained`、それ未満 `Critical`。
- `pomodoro15`、`pomodoro25`、`pomodoro50` があり、休憩はそれぞれ 3、5、10 分。状態は `settings` に保存し、残時間の正本は開始時刻と停止状態から計算する。
- 通知は API プロセスが担当し、Critical への遷移とポモドーロのフェーズ遷移を一度だけ通知する。

## UI の直接依存

- HTTP API の固定 URL は `frontend/src/App.jsx` の `API_BASE`。
- `frontend/src/utils/helpers.js` は `window.require('electron')` で IPC を直接取得する。
- renderer 間の同期は `window-event:notify` / `window-event:received` を使う。
- これらは Phase 2 で Desktop API に隠蔽し、React コンポーネントから除去する。
