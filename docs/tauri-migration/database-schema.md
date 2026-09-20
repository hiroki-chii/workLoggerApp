# DB・時刻仕様

## 保存場所と接続

- DB パスは既定で `%APPDATA%\\workloggerapp\\logs.db`。
- `WORKLOGGER_DATA_DIR` が設定されている場合はそのディレクトリ配下の `logs.db`。
- SQLite は WAL モードで開く。
- Tauri 版でも同じファイルを開き、移行完了までテーブル形状・カラム型・既存値を変更しない。

## スキーマ

```sql
CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appName TEXT,
  windowTitle TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE window_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  replace_with TEXT NOT NULL,
  match_type TEXT NOT NULL,
  color TEXT
);
```

`logs.timestamp` には現行 PowerShell から文字列日時が保存され、既存 SQL は SQLite の `datetime(..., 'localtime')`、`date`、`strftime` を用いる。Rust の内部時刻を Unix epoch milliseconds に統一しても、DB 互換 adapter は現行と同じ SQLite datetime 表現で読み書きする。

## 設定キー

| キー | 既定値・意味 |
|---|---|
| `sampling_interval` | `10` 秒 |
| `idle_threshold` | `60` 秒 |
| `default_activity_color` | `#6366f1` |
| `show_mini_on_close` | `true` |
| `mini_window_position` | `右下` |
| `mini_window_x` / `mini_window_y` | ピクセル座標（存在時） |
| `show_pet_in_mini` | `true` |
| `current_mode` | `tracking` / `pomodoro15` / `pomodoro25` / `pomodoro50` |
| `enable_fatigue_alert` | `true` |
| `pomodoro_start_ms` | epoch milliseconds 文字列 |
| `pomodoro_status` | `running` / `paused` |
| `pomodoro_remaining_ms` | epoch milliseconds ではなく残り時間 milliseconds 文字列 |
| `pomodoro_paused_phase` | `work` / `break` |
| `sliding_window_size` | `90` 分 |
| `power_saving` | `true` |

## Rust 側の DB ルール

- `Database { connection: Mutex<rusqlite::Connection> }` を AppState が所有する。
- DB lock 中に Win32 API 呼び出し、Tauri event 発行、`await` をしない。
- command や worker は Repository trait だけを使い、SQL は `infrastructure/database` に閉じ込める。
- `VACUUM` を含むデータ破壊操作は、現行の「全ログ削除」と同じ明示操作にだけ対応させる。
- スキーマ改善や timestamp の型変更は Phase 10 後の別タスクにする。
