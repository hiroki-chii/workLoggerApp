# 段階的移行計画と差異台帳

## 差異台帳

| ID | 参照設計 | 現行実装 | 既存仕様を維持する最小変更 |
|---|---|---|---|
| D-01 | React は表示・入力のみ | HTTP API と `window.require('electron')` に直接依存 | Phase 2 で Desktop API を導入し、既存呼び出しの契約を adapter 化する |
| D-02 | Rust が DB を所有し内部時刻は epoch ms | Better-SQLite3/Express が DB を所有し、`logs.timestamp` は SQLite datetime 文字列 | Phase 3 で `rusqlite` に同一 DB を開かせ、datetime 変換は Repository adapter に閉じ込める |
| D-03 | 監視は Rust worker | Node Collector + 常駐 PowerShell | Phase 4 で PowerShell を `ActivitySource` として使い、Phase 5 で `windows` crate 実装へ置換する |
| D-04 | Pure Rust の疲労エンジン | Node が可変ウィンドウのサンプル数で 5 段階を計算 | 既存の 90 分初期値、設定キー、閾値、出力を Golden Master 化して Rust に移す |
| D-05 | Tauri command/event | Express HTTP と renderer 間 Electron IPC | HTTP/IPC のユースケースを同名相当の command に移し、イベントは変更時だけ送る |
| D-06 | Tauri Tray/Single Instance/Autostart | Tray と単一起動は Electron、自動起動は未実装 | Close/Tray/2 回目起動を先に再現し、Autostart は新機能として有効化設定を追加する段階まで保留 |
| D-07 | Tauri の安全な WebView 境界 | `nodeIntegration: true`、`contextIsolation: false` | Phase 2 で React から特権 API を除去し、Tauri capability を必要 command だけに限定する |
| D-08 | Rust が DB を所有する | 既存 DB への WAL 設定も書き込みになる | Phase 3 は既存 DB を読み取り専用で開く。書き込み開始と接続モード変更は Phase 4 で行う。 |
| D-09 | PowerShell と Win32 は未取得値を同一視する | PowerShell は `"None"` / `null`、空タイトル / `null` を返す場合がある | いずれも既存 collector では保存しない。比較時に「未取得」へ正規化し、保存仕様を変更しない。 |
| D-10 | 電源状態をバックエンドで扱う | Electron は `powerMonitor` の suspend/resume callback で collector を止めて復帰する | Tauri/Wry の公開 API には同等 callback がない。サスペンド中は worker thread も停止して記録されず、復帰後の最初の Win32 sample と既存の timeout/retry 経路で監視を再開する。外部から観測できる記録・通知・再開の仕様を変えず、raw Win32 message hook は導入しない。 |
| D-11 | Tauri 版は React の全 Desktop API を提供する | Phase 3–7 時点では未接続機能があった | Phase 8 で設定更新、ポモドーロ、ログ削除、疲労リセット、ルール編集、event 契約を Rust に移し、互換確認後に Electron を削除した。 |
| D-12 | Renderer 間の更新通知は Tauri event で同期する | Electron は `window-event:notify` IPC を main/mini の両 renderer へ中継する | `notifyAppChanged` と記録開始・停止 command から `activity-updated` を emit し、既存の `onAppChanged` 購読を維持する。 |

## 実装 Phase

### Phase 0 — 仕様固定（完了）

- 本ディレクトリの文書を作成し、DB、IPC、機能、差異を記録する。
- プロダクションコードは変更しない。

完了条件: この Phase の文書がレビューされ、既存の 90 分ウィンドウや日時表現などの互換判断が明示されていること。

### Phase 1 — Tauri Bootstrap（完了）

- 既存 `frontend/` を変更せず `src-tauri/` を追加する。
- `npm run tauri dev` で Main UI を表示する。
- DB、監視、PowerShell、疲労、Autostart はこの段階で接続しない。

完了条件: Electron を起動せず、同じ React UI が Tauri Window に表示される。`npm run tauri dev` で Vite と Tauri Window が起動することを確認済み。現行 API は未接続のため、データ表示の互換性は Phase 2 以降で確認する。

### Phase 2 — Desktop API abstraction（完了）

- `frontend/src/infrastructure/desktop/` に Electron/Tauri adapter を置く。
- React から `window.require`、固定 HTTP URL、IPC channel 名への直接参照を除去する。
- 現行 Electron adapter は既存 IPC/API を呼び、Tauri adapter は未実装 command を明示的に扱う。

完了条件: UI コンポーネントが `DesktopApi` だけに依存し、Electron 版の全機能が動く。`frontend/src/infrastructure/desktop/` に Electron/Tauri adapter を追加し、Electron API/IPC の互換テストを完了。

### Phase 3 — Rust SQLite repository（完了）

- `rusqlite` で既存 `logs.db` を読み取り専用で開き、既存スキーマを変更せずに統計、履歴、ヒートマップ、詳細、疲労、設定、ルールを command 化した。
- CSV の内容生成も Rust 側へ移し、既存のルール適用順、ヘッダー、15 分単位の時刻表を維持した。Tauri adapter は生成結果を Blob URL として既存のダウンロード UI へ渡す。
- 同一スキーマの SQLite fixture で統計、履歴、ヒートマップ、タイトル置換、両 CSV を検証し、既存 DB を開いた `npm run tauri dev` の起動を確認した。

完了条件: DB ファイルを変更せず、同一入力で現行と同じ表示データを返す。既存 DB は読み取り専用接続のため、Phase 3 の起動は DB の WAL・設定・ログを変更しない。

### Phase 4 — PowerShell 併用 Tauri 版（完了）

- Rust worker が既存 `monitor.ps1` を 1 プロセスだけ起動し、stdin/stdout の既存 `sample` 行プロトコルを利用する。
- 現行 collector と同じ 60 秒 idle 閾値、設定由来のサンプリング間隔、15 秒タイムアウト、5/10/20/40/60 秒の再起動バックオフで SQLite へ保存する。
- `activity-updated` event、現在の idle 状態、記録開始/停止 command を Rust 側へ集めた。停止時には monitor を終了し、再開時には新しい monitor を起動する。休止からの復帰後に monitor が応答しない場合も同じタイムアウトと再起動経路で回復する。
- 既存の Critical・ポモドーロ遷移通知を Rust worker に移し、Tauri の native notification plugin で表示する。`monitor.ps1` は Tauri bundle resource に同梱する。

完了条件: Electron/Express なしで、既存 PowerShell を使った Tauri 版が一日常駐できる。PowerShell helper の連続サンプル、ログ保存、再試行間隔、通知遷移を自動テストで検証済み。長時間常駐の実機確認は Phase 8 の配布検証で実施する。

### Phase 5 — Windows 監視の Rust 化（完了）

- `windows-sys` で `GetForegroundWindow`、`GetWindowTextW`、`GetWindowThreadProcessId`、`GetLastInputInfo`、`OpenProcess`、`QueryFullProcessImageNameW` を `infrastructure/windows/` に限定して実装した。
- PowerShell と同時にサンプルを取り、app name、title、idle time を比較した。D-09 の未取得値を正規化した後、同一サンプルで一致することを検証した。
- 既定の監視ソースを Rust Win32 に切り替えた。`WORKLOGGER_ACTIVITY_SOURCE=compare` は PowerShell を主ソースにして差異 event を出し、`powershell` は緊急時の互換切替として残す。

完了条件: 差分の理由を解消または仕様化した後、PowerShell `ActivitySource` を削除できる。PowerShell 実装は Phase 8 の長時間配布検証が済むまで、比較・緊急切替専用に保持する。

### Phase 6 — Pure Rust FatigueEngine（完了）

- `domain/activity.rs`、`domain/fatigue.rs`、`domain/pomodoro.rs` へ計算を移した。Domain は SQLite、Tauri、Win32、システム時刻を参照しない。
- `FatigueService` に `Clock` を注入し、Repository は `ActivityWindow` の取得だけを担当する。
- 既存の 90 分初期値、可変 `sliding_window_size`、5 段階閾値、ポモドーロの設定キーと出力形式を維持した。
- Node 実装と同じ境界値で、5 段階の疲労判定、ポモドーロの実行中 deadline・phase sequence、一時停止状態を Golden Master として固定した。

完了条件: Golden Master と新しい Rust 単体テストがすべて通る。Rust Domain、既存 Electron テスト、Tauri debug build で検証する。

### Phase 7 — 常駐機能（完了）

- `tauri-plugin-single-instance` を起動順の早い段階で登録し、二重起動時は既存の main window を復元・前面化する。
- Tauri Tray に既存と同じ `表示`・`終了` メニューと左クリックでの main window 復元を実装した。終了時には worker を停止する。
- Close は終了せず main window を隠す。`show_mini_on_close` が有効なら 240×160 の frameless/transparent/always-on-top mini window を右下に表示する。mini window の移動後座標は同じ `settings` テーブルに保存し、接続されていないディスプレイ上の座標なら既存の右下初期配置に戻す。
- React の既存 `showMiniWindow`、`showMainWindow`、`quitApplication` は Tauri command に対応付けた。Phase 4 の native notification worker はそのまま常駐ライフサイクルとともに停止する。
- D-10 のとおり、明示的な suspend callback は追加せず、復帰後の worker sample/retry で Electron 版と同じ記録停止・再開の外部動作を維持する。

完了条件: Main/mini/Tray/再起動/休止復帰の操作が現行と一致する。Rust 単体テスト、既存 Electron テスト、Tauri debug build で検証する。

### Phase 8 — 配布と Electron 削除（完了）

- NSIS installer の生成、新規インストール、隔離 DB での起動、アンインストールを検証した。記録は [release-validation.md](./release-validation.md) に残す。
- Tauri command に設定更新、ポモドーロ、ログ削除、疲労リセット、ルール編集、renderer 間同期を追加し、Electron API との操作契約を移した。
- PowerShell helper は `src-tauri/resources/monitor.ps1` に同梱し、緊急切替用として維持する。
- Tauri 環境での確認完了後、Electron、Express、Better-SQLite3、Electron 専用テストを削除した。確認完了はユーザーから報告された。

完了条件: `npm run tauri build` の配布物だけで必要な全機能が稼働し、Tauri 環境での確認を終えること。完了。

## 最終ディレクトリ設計

```text
src-tauri/src/
├─ domain/              # Pure Rust: activity, fatigue, pomodoro, settings
├─ application/         # services と ports
├─ infrastructure/
│  ├─ database/         # rusqlite repository と既存 DB adapter
│  ├─ windows/          # Win32 実装。unsafe はここに限定
│  └─ powershell/       # Phase 4 の一時的 ActivitySource
├─ interface/           # commands, events, DTO
├─ app_state.rs
├─ error.rs
├─ lib.rs
└─ main.rs
```

依存方向は `interface → application → domain`。`infrastructure` は application の port を実装する。Domain から Tauri、SQLite、Win32、React への依存は禁止する。
