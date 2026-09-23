# ゆとリズム Tauri 移行記録

このディレクトリは、Electron 版から Tauri 2 版への移行判断、互換性条件、検証結果を残す記録です。Tauri 版への移行と Electron 実装の削除は完了しています。

## 現行の設計

現在のアプリは次の構成です。

- 対象は当面 Windows のみ、デスクトップ基盤は Tauri 2。
- React + Vite の UI は維持し、表示とユーザー入力のみを責務とする。
- Rust が Windows API、SQLite、監視、疲労判定、ポモドーロ、通知およびアプリのライフサイクルを所有する。
- Domain は Tauri、SQLite、Windows API、React に依存しない Pure Rust とする。
- React と Rust の境界はユースケース単位の Tauri command と、状態変更時だけ送る event に限定する。
- DB は Rust だけが読み書きする。移行中は既存 SQLite スキーマとデータを変更しない。
- 監視は専用 worker thread で実行し、既存のサンプリング間隔を保持する。
- 初期段階では既存 PowerShell を `ActivitySource` として再利用し、後から `windows` crate に置換する。
- Close はウィンドウを隠して監視を続け、Tray の「終了」のみが監視停止とアプリ終了を行う。

移行時点の比較資料として [current-architecture.md](current-architecture.md) と [feature-inventory.md](feature-inventory.md) を保管しています。これらは Electron 時代の基準を含む履歴資料です。

## 不変条件

1. Electron 実装は Tauri 版の互換確認後に削除済み。過去のリリースからの DB 互換性は維持する。
2. Tauri 移行と DB 再設計を同時に行わない。
3. 現行仕様との差異を見つけた場合、設計を勝手に変えない。差異を記録し、既存挙動を保つ最小変更を選ぶ。
4. 破壊的な DB 操作はコピーした DB を使う検証で先に確認する。
5. 疲労・ポモドーロの既存出力は Golden Master として固定し、Rust 化後も互換性を確認する。

## 文書

- [現行アーキテクチャ](current-architecture.md)
- [機能・互換性一覧](feature-inventory.md)
- [DB・時刻仕様](database-schema.md)
- [IPC/API 一覧](ipc-inventory.md)
- [段階的移行計画と差異台帳](migration-plan.md)
- [Phase 8 配布検証](release-validation.md)
