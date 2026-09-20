# 機能・互換性一覧

| 機能 | 現行の根拠 | Tauri 版の互換条件 | 移行先 |
|---|---|---|---|
| 活動記録 | `collector.js`、`monitor.ps1` | 既存の間隔・無操作 60 秒判定・記録対象を維持 | `ActivitySource` → Rust Win32 |
| 前面ウィンドウ | `monitor.ps1` | アプリ名、タイトル、取得失敗時の扱いを比較 | `infrastructure/windows` |
| 無操作状態 | `monitor.ps1`、`/status` | idleSeconds を UI に提供し、ログ除外条件を維持 | `IdleMonitor` |
| 疲労段階 | `activity-state.js` | 5 段階名、90 分初期値、閾値、既存レスポンスを維持 | Pure Rust `FatigueEngine` |
| Critical 通知 | `notifications.js`、Electron dialog | Critical への遷移時に一度だけ通知 | Rust notification service + Tauri window/dialog |
| ポモドーロ | `activity-state.js`、`server.js` | 15/25/50 分、休憩、pause/start/reset、永続化を維持 | Rust `PomodoroService` |
| 履歴・統計 | `server.js` | 日付範囲、アプリ/タイトル集計、上限 1,000 件を維持 | Rust repositories/commands |
| タイムテーブル | `server.js` | 15 分枠、最大活動アプリ/タイトルの選択を維持 | Rust repository |
| タイトル置換 | `window_rules` と `App.jsx` | exact / startsWith / contains、色、順序を維持 | Rust repository、UI 表示 adapter |
| CSV | `server.js` | 履歴・タイムテーブルの列とタイトル置換を維持 | Rust command + file save dialog |
| ミニ画面 | `electron-core/main.js` | 240×160、常に前面、位置永続化、Main と状態同期 | Tauri secondary window |
| 常駐 | `electron-core/main.js` | Close → hide、Tray から復帰・終了 | Tauri Tray |
| 単一起動 | `electron-core/main.js` | 2 回目の起動時に既存 Main Window を前面に出す | `tauri-plugin-single-instance` |
| 電源復帰 | `electron-core/main.js` | suspend で採取停止、resume で再開と UI 同期 | Tauri/Windows lifecycle adapter |

## Golden Master にするもの

Rust への置換前に、次の現行結果を固定するテストデータを作る。

- 疲労段階の閾値境界（idle rate 40 / 25 / 15 / 10 %）
- 設定したサンプリング間隔と `sliding_window_size` に対する期待サンプル数
- ポモドーロの開始、pause、再開、reset、作業/休憩遷移
- 午前 4 時の日替わり境界と日付範囲フィルター
- 15 分枠における同数時を含むタイムテーブル集計
- タイトル置換ルールの優先順と CSV 出力
- suspend/resume、記録開始/停止、Close/Tray/完全終了
