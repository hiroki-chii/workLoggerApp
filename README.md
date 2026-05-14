# ゆとリズム (Yutorhythm)

ゆとリズム は、ユーザーのPC作業を自動的に記録・分析し、「ゆとり」のある作業リズムと健康管理をサポートする Windows 向けデスクトップアプリケーションです。バイオレット＆ティールを基調としたモダンなデザインで、日々のワークライフバランスを整えます。

## 🌟 主な機能

### 📊 自動アクティビティ記録
- 10秒ごとにアクティブなウィンドウ名とタイトルを自動取得。
- 60秒以上の無操作を検知すると、自動的に記録を停止（プライバシーと正確性の両立）。

### 📈 疲労度分析 (Fatigue Tracker)
- 直近の稼働率に基づき、5段階の疲労レベル（Restored / Calm / Focused / Strained / Critical）をリアルタイム判定。
- スライディングウィンドウ（判定の基準時間）を 60分 / 90分 / 120分 から自身のスタイルに合わせて選択可能。
- 限界状態（Critical）到達時にはデスクトップ通知や最前面アラートで休憩を促します。

### 🍅 ポモドーロ・テクニック
- 15分/25分/50分の作業サイクルに対応。
- フェーズ切り替え時の通知機能。
- 疲労度が高い状態での作業開始に対する警告機能。

### 🪟 ミニウィジェット
- デスクトップの最前面に配置可能な小型ウィンドウ。
- 作業を邪魔することなく、疲労度やタイマーを常に確認できます。

### 🗓️ タイムテーブル（ヒートマップ）
- 1週間分の作業状況を15分刻みのヒートマップで可視化。
- セルをクリックすることで、その時間帯のアプリ使用内訳を詳細に確認可能。

### 🎨 心地よいデザインとカスタマイズ
- 「ゆとり」と「リズム」をイメージした、目に優しいバイオレット＆ティールのグラデーションテーマ。
- 正規表現を用いて、ウィンドウタイトルを分かりやすい名前に自動置換。
- アプリごとにカラーを割り当て、作業内容を直感的に把握。

## 🛠️ 技術スタック

- **Framework**: [Electron](https://www.electronjs.org/)
- **Frontend**: React (Vite), Vanilla CSS, Lucide-React, Chart.js
- **Backend**: Express
- **Database**: SQLite3 (Better-SQLite3)
- **OS Integration**: Windows PowerShell (Activity & Idle Detection)

## 🚀 セットアップ

### 必要条件
- Node.js (v18以上推奨)
- Windows OS (PowerShell を使用するため)

### インストール
```bash
git clone https://github.com/hiroki-chii/workLoggerApp.git
cd workLoggerApp
npm install
cd frontend && npm install
```

### 開発モードの起動
```bash
npm run dev
```

### ビルド (インストーラー作成)
```bash
npm run build
```
ビルドされたファイルは `dist-pulse` ディレクトリに出力されます。

## 📝 開発・構成

詳細なシステム構成やデータベース設計については [specification.md](./specification.md) を参照してください。

---

Developed with ❤️ for better work-life balance.
