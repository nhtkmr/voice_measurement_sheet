# 工程能力 音声入力測定シート

ノギス・マイクロメータを持ったまま、寸法を読み上げて測定値を入力する工程能力(Cp/Cpk)測定シート。
品番テンプレートから測定表を自動生成し、公差からOK/NGを自動判定、そのまま .xlsx 帳票として出力できる。

## 主な機能
- **行×列グリッド**: 行＝測定本数（任意追加）、列＝各寸法＋判定
- **品番テンプレート**: 品番ごとに項目名・基準値・上公差/下公差を登録 → シート自動生成。
  **JSONで書出/取込**でき、バックアップや他PCへの配布が可能（「テンプレ書出」「テンプレ取込」）
- **OK/NG自動判定**: 公差から良否を自動色分け（NG時は警告音＋読み上げ）
- **音声入力**: Web Speech API（ja-JP）。「12点34」「十二点三四」等を数値へ正規化
- **音声コマンド**: 「次」「戻る」「やり直し」、目視項目は「OK」「NG」
- **TTS読み返し**: 認識値を読み返して誤認識を防止
- **工程能力**: 列ごとに n / 平均 / σ / Cp / Cpk とヒストグラム（規格線つき）をリアルタイム表示
- **Excel出力**: 「測定表」＋「工程能力」サマリの .xlsx
- **自動保存**: IndexedDBへ保存し、再読込で測定中データを復元。PWA対応

## セットアップ
```powershell
npm install
npm run dev      # http://localhost:5173 （音声認識に必要な secure context を満たす）
```

## ビルド / テスト
```powershell
npm run build    # 型チェック + 本番ビルド (dist/)
npm test         # 単体テスト（数値正規化・工程能力）
npm run preview  # ビルド結果のプレビュー
```

## 使い方
1. ブラウザ（**Edge / Chrome**）で開く
2. 「テンプレ編集」で品番・測定項目・公差を登録
3. 品番を選び「新規測定」でシート生成
4. 「🎤 音声開始」→ マイク許可 → 寸法を読み上げ。値入力→自動で次セルへ
5. 「Excel出力」で .xlsx 保存

## 制約・補足
- Web Speech API は**ネット接続が必要**／**Edge・Chrome のみ**（Firefox非対応）。
  非対応時もキーボード/テンキー手入力で全機能利用可。
- 音声認識は `src/voice/recognizer.ts` のアダプタ層で抽象化済み。
  将来オフライン（Vosk等）へ差し替える場合はこの層のみ置換すればよい。
- 無償版 SheetJS はセル背景色の書込に未対応のため、Excel上のNGは判定列の "NG" 文字で表現。

## 構成
```
index.html / styles.css / manifest.webmanifest   画面・スタイル・PWA定義
src/
  main.ts            画面初期化・状態管理・音声/保存/出力の統合
  types.ts           共通の型定義
  grid.ts            測定グリッド描画
  template.ts        品番テンプレCRUD・公差計算・JSON書出/取込 (localStorage)
  judge.ts           公差からのOK/NG判定
  stats.ts           平均/σ/Cp/Cpk
  histogram.ts       ヒストグラム描画 (canvas)
  format.ts          公差の表示文字列フォーマット
  exportXlsx.ts      .xlsx 出力 (SheetJS)
  store.ts           測定データ保存/復元 (IndexedDB)
  voice/
    numberParser.ts  日本語数値→number 正規化・音声コマンド判定
    recognizer.ts    Web Speech API アダプタ / TTS / 警告音
  *.test.ts          単体テスト (Vitest)
```

## 構成ファイル（設定）
プロジェクト直下にある設定ファイルの役割。

| ファイル | 役割 |
|---|---|
| `package.json` | プロジェクト定義。依存パッケージ（`xlsx`=Excel出力, `idb`=IndexedDB / 開発: `vite`,`typescript`,`vitest`）と npm スクリプト（`dev`/`build`/`preview`/`test`）を記述 |
| `tsconfig.json` | TypeScript コンパイラ設定。`strict` 有効・`target: ES2020`・`lib` に DOM を含め、`src` のみを型チェック対象にする |
| `vite.config.ts` | 開発サーバ／ビルド設定。`base: './'`（相対パス出力で社内サーバ配置に対応）、`server.host: true`（同一LAN内の実機タブレットから接続可）、`port: 5173`、出力先 `dist/` |
| `index.html` | エントリHTML。ツールバー・グリッド・統計パネル・テンプレ編集ダイアログの骨格と、`manifest`/`styles.css`/`src/main.ts` の読込 |
| `styles.css` | 画面スタイル（グリッド・判定色・統計カード・ダイアログ等） |
| `manifest.webmanifest` | PWA 定義（アプリ名・表示モード `standalone`・テーマ色）。タブレットへインストール可能にする |
| `.gitignore` | Git 管理から除外する生成物（`node_modules`/`dist` 等） |

### npm スクリプト
| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバ起動（http://localhost:5173、音声認識に必要な secure context を満たす） |
| `npm run build` | 型チェック（`tsc`）＋本番ビルド（`dist/` 出力） |
| `npm run preview` | ビルド結果のローカルプレビュー |
| `npm test` | 単体テスト（Vitest） |
