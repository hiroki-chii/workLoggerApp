# IPC・HTTP API 一覧

## Electron IPC

| 現行 channel | 用途 | Tauri での移行先 |
|---|---|---|
| `recording:start` | Collector 開始 | `start_recording` command |
| `recording:stop` | Collector 停止 | `stop_recording` command |
| `recording:status` | 記録状態取得 | `get_app_snapshot` に統合 |
| `app:quit-completely` | worker/API 停止後に終了 | `quit_application` command |
| `mini-window:open` | ミニ画面を開き Main を隠す | `show_mini_window` command |
| `mini-window:close` | ミニ画面を閉じ Main を表示 | `show_main_window` command |
| `alert:danger` | 警告ダイアログ | Rust notification service（UI には状態 event） |
| `alert:confirm` | モード切替時の確認 | UI 固有の確認ダイアログ。Phase 2 では adapter に残す |
| `window-event:notify` / `received` | 2 renderer の再読込同期 | `yutorizumu://app-changed` event |

## Express API

| HTTP endpoint | 現行の用途 | Tauri command / event |
|---|---|---|
| `GET/POST /status` | 無操作秒数 | `get_app_snapshot`、`activity-changed` |
| `GET /stats` | アプリ/タイトル統計 | `get_activity_statistics` |
| `GET /logs` | 履歴 | `get_activity_history` |
| `GET /logs/breakdown` | 15 分枠詳細 | `get_activity_breakdown` |
| `DELETE /logs/clear` | 全履歴削除 | `clear_activity_history` |
| `GET /fatigue` | 疲労・ポモドーロ | `get_app_snapshot`、`fatigue-changed` |
| `POST /fatigue/reset` | 当日ログ削除 | `reset_fatigue` |
| `POST /pomodoro/control` | pause/start/reset | `pause_pomodoro`、`resume_pomodoro`、`reset_pomodoro` |
| `GET/POST /settings` | 設定取得・更新 | `get_settings`、`update_settings` |
| `GET /window-titles` | 置換候補 | `get_window_titles` |
| `GET/POST/PUT/DELETE /window-rules` | 置換ルール | `list/create/update/delete_window_rule` |
| `GET /export` | 履歴 CSV | `export_history_csv` |
| `GET /export/timetable` | タイムテーブル CSV | `export_timetable_csv` |
| `GET /heatmap` | 15 分枠集計 | `get_heatmap` |

## Event 契約

イベントは変更通知に限る。payload は次の共通 envelope を使用する。

```ts
interface AppEvent<T> {
  schemaVersion: 1;
  emittedAtMs: number;
  payload: T;
}
```

- `yutorizumu://activity-changed`
- `yutorizumu://fatigue-changed`
- `yutorizumu://pomodoro-changed`
- `yutorizumu://app-changed`

React はイベントを受けたら、必要なユースケース command で状態を再取得する。低レベルの SQL、PowerShell、ファイル操作、Windows API は公開しない。
