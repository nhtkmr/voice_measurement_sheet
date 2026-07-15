# 開発仕様書 / プログラム仕様書

工程能力 音声測定シート（`voice-measurement-sheet`）の**内部設計書**。改修する開発者向けに、モジュール責務・データモデル・アルゴリズム・永続化スキーマを記述する。

利用者向けの概要・使い方は [`../README.md`](../README.md)、デプロイ手順は [`../DEPLOY.md`](../DEPLOY.md) を参照。

> この文書はコードを正とする。記述と実装が食い違った場合は実装が正しく、この文書のバグである。

---

## 1. 目的・スコープ・用語

ノギスやマイクロメータを持ったまま測定値を読み上げ、工程能力（Cp/Cpk）を算出して Excel 帳票にするツール。手が塞がった現場で「測る → 記録する」の往復をなくすことが狙い。

### 用語

| 用語 | 意味 | 対応する型 |
|---|---|---|
| 品番テンプレート | 品番ごとの測定項目定義。測定シートの雛形 | `Template` |
| 項目 | 測定する1つの寸法・角度・目視チェック。シート上の列 | `MeasureItem` |
| セッション | 1回の測定作業。テンプレから生成される実データ | `Session` |
| 本数 | 測定するワークの個数。シート上の行 | `Row` |
| 上公差 / 下公差 | 基準値からの**符号付き偏差**（例 `+0.05` / `-0.05`） | `upperTol` / `lowerTol` |
| 上限 / 下限 (USL/LSL) | 基準値＋公差で算出される**派生値** | `upper` / `lower` |

### スコープ外

オフライン動作、測定機器との直接通信（すべて音声または手入力）、ユーザーごとのデータ分離（データはチーム全員で共有する）。

---

## 2. システム構成

```
ブラウザ (Edge/Chrome)
  │  Vite ビルドの静的SPA（フレームワークなし・素のTypeScript）
  │
  ├─ localStorage ── 端末ローカル: UI設定・テンプレのキャッシュ・直近セッションID
  │
  └─ fetch /api/*
        │
        ▼
Azure Static Web Apps
  ├─ 静的コンテンツ配信 (dist/)
  ├─ Entra ID 認証（全ルート authenticated）
  └─ 統合 Azure Functions (api/ · Node 20 · v3 プログラミングモデル · 素のJS)
        │
        ▼
     Cosmos DB (DB: vms)
        ├─ コンテナ templates
        └─ コンテナ sessions
```

**測定セッションもテンプレートもサーバに保存され、ログインした全員で共有される。** 端末ローカルには残らない（キャッシュを除く）。

### 認証の責務分界

ここは誤解しやすいので明記する。**API 側の関数は `authLevel: "anonymous"`（`api/*/function.json`）だが、これは無認証で公開されているという意味ではない。** 認証は SWA のルート認可で前段に掛かっている:

```jsonc
// public/staticwebapp.config.json
"routes": [{ "route": "/*", "allowedRoles": ["authenticated"] }],
"responseOverrides": { "401": { "redirect": "/.auth/login/aad", "statusCode": 302 } }
```

`/*` は `/api/*` も含むため、未認証リクエストは Functions に到達する前に SWA が弾く。**SWA 以外（ローカルの `func start`、他ホスティング）に配置すると API は完全に無防備になる。**

`staticwebapp.config.json` が `public/` 配下にあるのは意図的で、Vite が `public/` の中身を `dist/` へコピーするため。**リポジトリのルートに置くとビルド出力に入らず、配信されず、認証が掛からない。**

---

## 3. 技術スタック / ビルド設定

| 項目 | 内容 |
|---|---|
| フロント | 素の TypeScript + DOM API。**フレームワーク・状態管理ライブラリなし** |
| ビルド | Vite 5 |
| 実行時依存 | `xlsx` (SheetJS 0.18) **のみ** |
| バックエンド | Azure Functions v3 モデル・素の JS（TypeScript ではない）・`@azure/cosmos` ^4.2 |
| テスト | Vitest 2（`vitest.config.ts` は無く `vite.config.ts` を継承） |

### `vite.config.ts`

```ts
base: './',                        // 相対パス出力。サブパス配置を可能にする
server: { host: true, port: 5173 }, // host:true = 0.0.0.0 待受。現場タブレットからLAN接続するため
build: { target: 'es2020', outDir: 'dist' }
```

### `tsconfig.json`

`strict: true` / `target: ES2020` / `noEmit: true` / `include: ["src"]`。

`noEmit` なのはトランスパイルを Vite(esbuild) が行うため。`tsc` は**型チェック専用のゲート**として `"build": "tsc && vite build"` に組み込まれている。`include` が `src` のみなので **`vite.config.ts` と `api/` は型チェックされない**。

---

## 4. データモデル

`src/types.ts` が単一の情報源。

```ts
type ItemType = 'dimension' | 'visual' | 'angle';
type AngleFormat = 'decimal' | 'dms';
type Judgment = 'OK' | 'NG' | null;

function isNumericItem(type: ItemType): boolean  // dimension | angle → true

interface MeasureItem {
  id: string;
  label: string;          // 例 "外径A"
  type: ItemType;
  nominal?: number;       // 基準値
  upperTol?: number;      // 上公差（符号付き偏差 例 +0.05）
  lowerTol?: number;      // 下公差（符号付き偏差 例 -0.05）
  upper?: number;         // 上限 USL = nominal + upperTol ← 派生値
  lower?: number;         // 下限 LSL = nominal + lowerTol ← 派生値
  unit?: string;
  decimals?: number;      // 表示桁。ヒストグラムのビン幅にも使う
  angleFormat?: AngleFormat;
}

interface Template { partNo: string; name?: string; process?: string; items: MeasureItem[]; }
interface Row { values: (number | null)[]; judgments: Judgment[]; }
interface Session {
  id: string; partNo: string; name?: string; process?: string;
  label?: string;         // 保存名（読み込み一覧での識別用）
  date: string;           // ISO
  items: MeasureItem[];   // ← テンプレのスナップショット
  rows: Row[];
}
interface ColumnStats { n; mean; sigma; min; max; cp; cpk; ngCount }
```

### 設計上の要点

1. **公差は符号付き偏差**。`lowerTol` は通常負の値なので、下限の算出も `nominal + lowerTol` と**加算**になる。減算ではない。
2. **`upper`/`lower` は派生値**。`applyTolerance()` が唯一の算出経路で、取り込み時も再計算される（後述）。手で書き換えてはいけない。
3. **角度の内部表現は常に10進度**。`angleFormat` は入出力の見せ方だけを決める。したがって判定・統計・ヒストグラムは寸法と角度を区別せず同じ数値ロジックで扱える。
4. **`Session.items` はテンプレのスナップショット**（`newSessionFromTemplate` が `{...i}` で複製）。後からテンプレートを編集しても、過去のセッションの列定義・公差は変わらない。これは意図的な設計で、測定記録の再現性を担保している。
5. `values` と `judgments` は**項目配列と同じ添字**で対応する並列配列。項目を増減させる操作は両方を揃えて更新する必要がある。

---

## 5. 永続化

3層あり、それぞれ性質が違う。混同すると事故る。

### 5-1. サーバ（Cosmos DB） — 真の情報源

| | |
|---|---|
| DB | `vms`（`createIfNotExists` で自動作成） |
| コンテナ | `templates` / `sessions`（同上） |
| パーティションキー | パス `/partitionKey`、値は**全ドキュメント一律 `'shared'`** |
| ドキュメントID | テンプレ: `templateKey()` の複合キー / セッション: `session.id` (UUID) |
| 接続 | 環境変数 `COSMOS_CONNECTION_STRING`（SWA のアプリケーション設定） |

全件を単一の論理パーティションに入れているのは「データはチーム全員で共有」という要件に対する意図的な単純化（`api/shared/cosmos.js`）。Cosmos の論理パーティション上限（20GB）が理論上の天井になるが、測定データの規模では問題にならない。

`strip()` が `partitionKey` と Cosmos のシステム項目（`_rid` `_self` `_etag` `_attachments` `_ts`）を除去してからクライアントへ返すため、クライアントの型は Cosmos の存在を知らない。

### 5-2. localStorage — テンプレの端末キャッシュ

| キー | 内容 |
|---|---|
| `vms.templates` | `Record<templateKey, Template>` の JSON。**マップであって配列ではない** |

テンプレの読み取り（`loadTemplates` / `listTemplates` / `getTemplate`）を**同期関数のまま高速に返す**ためのキャッシュ。真の情報源ではない。

- 起動時に `initTemplates()` がサーバから全件取得してキャッシュを**丸ごと上書き**。失敗時はキャッシュを維持してアプリを続行する（degrade）。
- 書き込み（`saveTemplate` / `deleteTemplate`）はキャッシュを更新してから `void apiUpsert(tpl)` でサーバへ**非同期の best-effort 反映**。失敗は `console.error` のみ。

### 5-3. localStorage — 端末ローカル設定

サーバへは同期されない。端末ごとの好み。

| キー | 既定値 | エンコード | 用途 |
|---|---|---|---|
| `vms.currentSessionId` | — | 生の文字列 | 再読込時に復元するセッションID |
| `vms.ngVoice` | `true` | `!== '0'` | NG時の「NGです」読み上げ |
| `vms.advanceDir` | `'item'` | `=== 'row' ? 'row' : 'item'` | カーソル前進方向 |
| `vms.slowInput` | `false` | `=== '1'` | ゆっくり入力モード |
| `vms.showHistogram` | `true` | `!== '0'` | ヒストグラム表示 |

**既定ONの設定は `!== '0'`、既定OFFは `=== '1'` で判定する。** 未設定・値の破損時に既定値へ倒れ、例外を投げないための書き方。新しい設定を足すときはこの流儀に合わせること。

### 5-4. テンプレートの複合キー

```ts
const SEP = '␟';
export function templateKey(t) {
  return `${t.partNo}${SEP}${t.name ?? ''}${SEP}${t.process ?? ''}`;
}
```

品番＋品名＋工程の3つでテンプレを識別する（同じ品番でも工程が違えば別テンプレ）。

**旧形式データの移行は `loadTemplates()` が暗黙に行う。** 保存されているキーを一切信用せず、各値から `templateKey(v)` を再計算してマップを組み直すため、品番のみをキーにしていた旧データは読み込んだ時点で自動的に新しい複合キーへ移行する。

---

## 6. REST API 仕様

すべて `api/` 配下の Azure Functions。ルートは各 `function.json` の `route` で定義。

| メソッド | ルート | 実装 | 動作 |
|---|---|---|---|
| GET | `/api/sessions` | `api/sessions/` | 全セッションを `ORDER BY c.date DESC` で取得 |
| GET | `/api/sessions/{id}` | `api/sessions-item/` | 1件取得。無ければ 404 |
| PUT | `/api/sessions/{id}` | `api/sessions-item/` | upsert。**ルートの `id` が body の id より優先** |
| DELETE | `/api/sessions/{id}` | `api/sessions-item/` | 削除。存在しなくても 200 |
| GET | `/api/templates` | `api/templates/` | 全テンプレ取得（`readAll`） |
| POST | `/api/templates` | `api/templates/` | upsert。`partNo` 必須（無ければ 400） |
| DELETE | `/api/templates/{key}` | `api/templates-delete/` | 複合キー指定で削除 |

- レスポンス body は `strip()` 済みのドキュメント、または `{ ok: true, id }`。
- エラーは `{ error: string }`。例外は一律 500。
- **`COSMOS_CONNECTION_STRING` 未設定時は `getContainer()` が throw し、全APIが 500 を返す。** この場合アプリは起動して動くが共有は無効になる。起動時に `initTemplates()` が到達性を返すため、**「⚠ 共有サーバに接続できません」がツールバーに出る**（§9-4）。

### クライアント側

| モジュール | 対応 |
|---|---|
| `src/store.ts` | `/api/sessions` — セッションCRUD |
| `src/template.ts` | `/api/templates` — テンプレ同期 |

**両モジュールとも例外を投げず、`console.error` に記録して結果を戻り値で返す**。ネットワーク断でもアプリを止めないための設計。

| 関数 | 失敗時の戻り値 |
|---|---|
| `saveSession` | `false`（成功で `true`） |
| `initTemplates` | `false`（到達できた／同期不要なら `true`） |
| `getSession` | `undefined` |
| `listSessions` | `[]` |

`saveSession` / `initTemplates` の戻り値は**呼び出し側が保存ステータス表示・再試行・セッション切替の可否判断に使う**（§9-4）。`getSession` / `listSessions` の失敗は現状 UI に出ない。

---

## 7. モジュール構成と責務

```
index.html / styles.css / manifest.webmanifest   画面・スタイル・PWA定義
public/
  staticwebapp.config.json  SWA 認証・ヘッダ設定（dist に入れるため public/ 配下）
  icons/                    PWAアイコン 192/512/maskable
src/
  main.ts          画面初期化・状態管理・イベント配線（唯一の状態保持者）
  types.ts         共通の型定義
  grid.ts          測定グリッド描画
  template.ts      テンプレCRUD・公差計算・JSON書出/取込・サーバ同期
  store.ts         セッションCRUD（/api/sessions クライアント）
  settings.ts      UI設定の localStorage 読み書き
  judge.ts         公差からのOK/NG判定
  stats.ts         平均/σ/Cp/Cpk
  histogram.ts     ヒストグラム描画 (canvas)
  format.ts        公差の表示文字列フォーマット
  angle.ts         角度の度分秒↔10進度変換・整形・解釈
  exportXlsx.ts    .xlsx 出力 (SheetJS)
  voice/
    numberParser.ts  日本語数値→number 正規化・音声コマンド判定
    recognizer.ts    Web Speech API アダプタ / TTS / 警告音
  *.test.ts        単体テスト (Vitest)
api/
  shared/cosmos.js   Cosmos 接続・コンテナ自動作成・strip()
  sessions/          GET /api/sessions
  sessions-item/     GET|PUT|DELETE /api/sessions/{id}
  templates/         GET|POST /api/templates
  templates-delete/  DELETE /api/templates/{key}
```

### 依存の向き

`main.ts` → その他すべて。**逆向きの依存は無い。**

`main.ts` 以外はすべて副作用の少ない部品（`judge` / `stats` / `histogram` / `format` / `angle` / `numberParser` は完全な純粋関数、`template` / `store` / `settings` は永続化に触れるが状態は持たない）。**アプリの可変状態を持つのは `main.ts` だけ**という制約が、この構成の要。

```ts
// main.ts — アプリ状態はこれだけ
interface AppState {
  templates: Record<string, Template>;
  session: Session;
  active: ActiveCell;   // { row, col } カーソル
}
let state: AppState;
```

UI設定は `state` に載せず、必要な箇所で毎回 `getAdvanceDir()` 等を localStorage から読む（キャッシュしない）。

### 拡張点

**`src/voice/recognizer.ts` が音声エンジン差し替えの唯一の継ぎ目。** Web Speech API への依存はこのファイルに閉じ込めてある。オフライン化（Vosk 等）が必要になったら、以下のインターフェースを満たす実装に置き換えれば他は変更不要:

```ts
export interface RecognizerHandlers {
  onResult: (transcript: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  onStateChange?: (listening: boolean) => void;
}
export function isVoiceSupported(): boolean;
export class Recognizer {
  constructor(handlers: RecognizerHandlers);
  start(): void;
  stop(): void;
  get listening(): boolean;
}
export function speak(text: string): void;
export function beep(freq?: number, durationMs?: number): void;
```

---

## 8. アルゴリズム仕様

本書の中核。ここに書かれたルールは業務判断に直結するので、変更時は必ずテストを伴うこと。

### 8-1. 公差 → 上下限（`template.ts: applyTolerance`）

```ts
upper = nominal != null && upperTol != null ? round6(nominal + upperTol) : undefined
lower = nominal != null && lowerTol != null ? round6(nominal + lowerTol) : undefined
round6(v) = Math.round(v * 1e6) / 1e6
```

- 基準値と該当する公差が**両方揃った側だけ**算出する。片方が欠ければその側は `undefined` のまま＝**片側公差に対応**している。
- `round6` は浮動小数のノイズ潰し。`0.1 + 0.2` が `0.30000000000000004` になるのを `0.3` に均す。テストで固定されている。

### 8-2. 判定（`judge.ts: judgeDimension`）

```ts
function judgeDimension(item: MeasureItem, value: number | null): Judgment
```

上から順に評価:

| 条件 | 結果 |
|---|---|
| 値が `null` / `NaN` | `null`（判定不可） |
| 目視項目 (`type === 'visual'`) | `null` — **自動判定しない** |
| 上限・下限が**両方**未設定 | `null`（判定不可） |
| `hasLower && value < lower` | `NG` |
| `hasUpper && value > upper` | `NG` |
| 上記以外 | `OK` |

**要点:**
- **境界値は OK**。比較が厳密不等号（`<` / `>`）なので `value === upper` は合格。公差の限界値は合格帯に含む。
- **片側だけ設定されていれば、その側だけで判定して `OK`/`NG` を返す**（欠けた側は無制限）。`null` になるのは**両方**欠けたときだけ。
- 目視項目の判定は自動化されず、クリック（`toggleVisual`）か音声コマンド（`applyVisualJudge`）でのみ設定される。
- 角度に特別扱いは不要。`upper`/`lower` が10進度で入っているので同じ数値比較で成立する。

### 8-3. 工程能力（`stats.ts`）

```
σ   = 標本標準偏差（n−1 で割る。母集団標準偏差ではない）
Cp  = (USL − LSL) / (6σ)
Cpk = min( (USL − x̄) / (3σ), (x̄ − LSL) / (3σ) )
```

境界条件が重要:

| 条件 | 結果 |
|---|---|
| `n < 2` | **σ = null** → Cp・Cpk も null に波及 |
| `σ === 0`（全値が同一） | **Cp・Cpk とも null**（ゼロ除算回避）。σ 自体は `0` として報告 |
| 上限・下限の片方のみ | Cp = null（**両側必須**）、Cpk は存在する側のみで算出 |
| 上限・下限とも無し | Cp・Cpk とも null |
| 目視項目 | Cp・Cpk とも null |
| `n === 0` | min・max とも null |

`n` は**有効値の個数**（`null`/`NaN` を除外した数）であって行数ではない。一方 `ngCount` は全行の `judgments` を独立に数える。

`cpkLevelColor(cpk)` の水準: `>= 1.33` 十分（緑 `#2e7d32`）/ `>= 1.0` 要注意（黄 `#f9a825`）/ それ未満 不足（赤 `#c62828`）/ `null` 灰。

### 8-4. ヒストグラム（`histogram.ts`）

**ビン幅は公差の小数桁から決まる。** Sturges や √n といった一般的な規則は使っていない。測定器の分解能に合った刻みで見せるための、この用途固有の設計。

```
STEP = 10 ** -dp
```

`dp` の決定（`binStepFor`）:
1. `item.decimals` があればそれを使う（テンプレ入力時の桁を保持。`"0.100"` → 3）
2. 無ければ旧データ向けフォールバック: `upperTol`/`lowerTol` の小数桁の最大値。公差が無ければ `round6(upper − nominal)` / `round6(lower − nominal)` から推定
3. 候補が無ければ `2`
4. `dp = Math.min(6, Math.max(0, dp))` にクランプ

例: ±0.05 → 2桁 → STEP 0.01 / ±0.1 → 1桁 → STEP 0.1

描画レンジ:
1. `lo = min(values)`, `hi = max(values)` を、**規格線が必ず画面に入るよう `item.lower`/`item.upper` まで拡張**
2. `lo === hi` なら ±1
3. 両端に8%のパディング
4. **ビン境界を STEP のグリッドへ整列**（`Math.floor(lo/STEP)*STEP` / `Math.ceil(hi/STEP)*STEP`）
5. `bins = Math.max(1, Math.round((hi−lo)/STEP))`、**`MAX_BINS = 300` でクランプ**（レンジが極端に広い場合のフォールバック。このときビン幅は公差桁より粗くなる）

canvas は 240×90（呼び出し側 `main.ts: renderStats` が指定）。**`devicePixelRatio` によるスケーリングはしていない**ので高DPIでは滲む。軸ラベルは `toFixed(2)` 固定で `item.decimals` を見ていない。

### 8-5. 角度（`angle.ts`）

内部表現は常に10進度。この modules は入出力の変換だけを担う。

```ts
dmsToDeg(d, m, s): number
degToDms(deg): { d, m, s, neg }
formatAngle(deg, format, decimals = 3): string
parseAngle(raw): number | null
```

**`dmsToDeg` の符号規則**: 符号は `d` にのみ宿る。`m`/`s` は `Math.abs` され、度の符号に従う。

```ts
const sign = d < 0 ? -1 : 1;
return sign * (Math.abs(d) + Math.abs(m)/60 + Math.abs(s)/3600);
```

制約として、**`d === 0` の負角（`-0°0'30"`）は表現できない**（`-0 < 0` は false）。実用上の問題は無いが、仕様として認識しておくこと。

**`degToDms` は「秒に丸めてから分解」する**。この順序が肝で、桁上がりが自動的に正確になる:

```ts
let total = Math.round(Math.abs(deg) * 3600); // ← 先に秒へ丸める
const d = Math.floor(total / 3600); total -= d * 3600;
const m = Math.floor(total / 60);   const s = total - m * 60;
return { d, m, s, neg: deg < 0 };
```

`0°0'59.6"` → `Math.round(59.6) = 60` → `0°1'0"` と繰り上がる。`d`/`m`/`s` は常に非負整数で、**符号は `neg` に外出し**されている（DMS 表記の各要素に符号を持たせない）。360度の正規化はしない。

**`parseAngle` の3段階**（上から順に試す）:

| 段 | 条件 | 例 |
|---|---|---|
| 1. マーカー | `度`/`°`、`分`/`'`/`′`、`秒`/`"`/`″` のいずれかがある。**欠けた要素は0扱い** | `45度30分15秒` / `45°30'15"` / `45度30分`→45.5 / `30分`→0.5 |
| 2. 区切り | 空白または `:` で分割して2〜3個が全て数値 | `45 30 15` / `45:30:15` |
| 3. 数値 | `parseNumber` へ委譲（漢数字・「点」もここで効く） | `45.5` / `四十五点五`→45.5 |

### 8-6. 音声の数値正規化（`voice/numberParser.ts: parseNumber`）

処理順（順序に意味があるので変更時は注意）:

1. 全角→半角（`０-９` `．` および `－ ー −` → `-`）
2. 単位・ノイズ語の除去（`ミリメートル|ミリ|センチ|マイクロ|度|mm|cm|μm` 等）と空白除去
3. 符号: 先頭の `マイナス|ﾏｲﾅｽ|negative|minus`（大小文字無視）または `-` → 負。先頭の `プラス|+` は除去。**先頭のみ**判定する
4. 小数点の統一 — **9通りを受理**: `点` `てん` `コンマ` `カンマ` `、` `，` `,` `ドット` `dot` `point` → すべて `.`
5. `.` で分割し、**2個以上あれば `null`**（`1.2.3` は不正）
6. 整数部を `kanjiIntToNumber` で解釈。**空でも可**（`点5` → `0.5`）
7. 小数部を `kanjiDigitsToString` で**1桁ずつ**解釈
8. `Number()` して符号を適用。`NaN` は `null`

**漢数字の整数部は位取りで解釈**する（`十` `百` `千`）。`current === 0 ? 1 : current` により `十二` → 12 の暗黙の1が効く。`二十三` → 23、`百五` → 105。**`万`・`億` は非対応**で、想定外の文字が1つでもあれば全体が `null`。

**小数部は位取りせず桁ごと**に読む。これが `十二点三四` → `12.34`（`12.3` + 何かではない）になる理由。測定値の読み上げは「じゅうにーてんさんよん」なので、この非対称性は正しい。

#### ⚠ 既知のバグ: 「メートル」を含む単位が解釈できない

**手順1（全角→半角）が手順2（単位除去）より先に走ることによる副作用。** 変換表 `ZEN_TO_HAN` は

```ts
'．': '.', '－': '-', 'ー': '-', '−': '-',
```

とマイナス記号のゆらぎを吸収しているが、この **`ー` は U+30FC＝カタカナの長音記号**である（`メートル` = `30e1 30fc 30c8 30eb`）。そのため単位除去が走る前に入力が壊れる:

```
'12.3ミリメートル' → (手順1) → '12.3ミリメ-トル' → (手順2) NOISE は 'ミリ' しか外せない
                  → '12.3メ-トル' → 小数部 '3メ-トル' が解釈不能 → null
```

実測（`parseNumber` の戻り値）:

| 入力 | 結果 | | 入力 | 結果 |
|---|---|---|---|---|
| `12.3ミリメートル` | **`null`** | | `12.3ミリ` | `12.3` |
| `12.3ミリメーター` | **`null`** | | `12.3センチ` | `12.3` |
| `12.3センチメートル` | **`null`** | | `12.3マイクロ` | `12.3` |
| `12.3メートル` | **`null`** | | `25mm` / `12.3cm` / `45度` | 可 |

結果として **`NOISE` の `ミリメートル` `ミリメーター` `センチメートル` `ミリ?メートル` の4つは全て到達不能**（先行選択肢に吸われるからではなく、その文字列がここへ届かないから）。実害は「ミリメートル」と読み上げた場合に値が入らないこと。ただし「ミリ」「センチ」だけなら通るため、現場では顕在化しにくい。

`ー` → `-` 変換自体は「ー12.3」を `-12.3` と読むために必要（実測で確認済み）なので、単純に消すと別の退行になる。修正するなら**単位除去を全角変換より先に回す**か、**`ー` の変換を先頭位置に限定する**のが筋。

なお `parseCommand` は全角変換を行わない（trim → 小文字化 → 空白除去のみ）ため、`オーケー` / `エヌジー` は正常に動作する。**この問題は `parseNumber` 固有。**

### 8-7. 音声コマンド（`voice/numberParser.ts: parseCommand`）

正規化（trim → 小文字化 → 空白除去）してから上から順にマッチ。**最初に一致したものを返す。**

| コマンド | パターン | マッチ方式 |
|---|---|---|
| `next` | `次` `つぎ` `next` | **部分一致** |
| `prev` | `戻る` `もどる` `前` `back` `prev` | **部分一致** |
| `undo` | `やり直し` `やりなおし` `取り消し` `消去` `クリア` `undo` `clear` | **部分一致** |
| `confirm` | `確定` `決定` `enter` | **部分一致** |
| `ok` | `オーケー` `おっけー` `おっけ` `良` `合格` `ok` | **完全一致** (`^...$`) |
| `ng` | `エヌジー` `だめ` `不良` `不合格` `ng` | **完全一致** (`^...$`) |

**この「部分一致 / 完全一致」の使い分けは意図的な設計。** `ok`/`ng` は2文字と短く誤爆しやすいため、発話全体がそれと一致する場合にのみ判定を下す（「OKです」では判定しない）。移動系は発話に混ざっても拾いたいので部分一致。

**コマンド判定は数値解釈より先**に走る。したがってコマンド語は数値より強い。

---

## 9. UI 挙動仕様

### 9-1. カーソル前進

`advanceDir` 設定（`vms.advanceDir`）で2通り。

| 設定 | 表示名 | `moveNext()` の挙動 |
|---|---|---|
| `'item'`（既定） | 項目方向 | `col++` → 行末で `col=0; row++` → **最終行を超えると `addRow()` で1本自動追加**（シートが無限に伸びる） |
| `'row'` | No.方向 | `row++` → 最終行で `row=0; col=(col+1)%nCols` にラップ（**行は増えない**） |

`movePrev()` は対称に戻るが、**先頭ではラップせずクランプ**する（行削除も末尾への巻き戻しもしない）。非対称は意図的。

### 9-2. NG時はカーソルを進めない

```ts
if (state.session.rows[row].judgments[col] !== 'NG') moveNext();
```

**測り直しのためその場に留まる。** `handleVoiceFinal` / `commitPending` / `applyVisualJudge` の**3箇所に同じルールが実装されている**ので、前進ロジックを触るときは3つとも揃えること。

### 9-3. 音声入力の2モード

| モード | 設定 | 挙動 |
|---|---|---|
| 即時（既定） | `slowInput = false` | `isFinal` の確定断片をそのまま `handleVoiceFinal()` へ |
| ゆっくり入力 | `slowInput = true` | 確定断片を `pendingBuf` に**連結**し、**無音 1200ms**（`SLOW_COMMIT_MS`）で自動確定。コマンドを認識したら即座に短絡 |

ゆっくり入力は「じゅうに……てん……さんよん」と区切って話しても1つの数値として解ける。`parseNumber` は断片の境界を意識しない設計なので、連結してから解釈すれば成立する（`numberParser.test.ts` がこの連結ケースを固定している）。

`commitPending(force)`: `force=true`（`次`/`確定` コマンド由来）はバッファが空・解釈不能でも前進する。`force=false`（無音タイムアウト由来）は前進しない。音声停止時は `resetPending()` で未確定バッファを破棄する。

### 9-4. 自動保存・保存ステータス・再試行

**保存はセッション全量の PUT であり差分ではない。** この性質がこの設計の土台になっている — 失敗しても次の保存が同じものを送れば復旧するため、**未送信キューも差分の再送も持たない**。再試行は「最新の `state.session` を送り直す」だけでよい。

保存は必ず `doSave()` を通る。`saveSession()` の直接呼び出しは `doSave()` 内の1箇所のみ。

```ts
type SaveState = 'saved' | 'saving' | 'unsaved' | 'offline';

const AUTOSAVE_MS = 400;     // 入力のデバウンス（トレーリング）
const RETRY_BASE_MS = 2000;  // 失敗後の初回再試行
const RETRY_MAX_MS = 30000;  // 指数バックオフの上限。回数は無制限
```

| 関数 | 役割 |
|---|---|
| `autosave()` | 400ms デバウンスして `doSave()`。新しい編集でバックオフをリセット。**約7箇所から呼ばれる唯一の入口** |
| `doSave()` | 保存 → ステータス反映 → 失敗なら上限付き指数バックオフで再試行し続ける |
| `flushSave()` | デバウンス・再試行を取り消して即時保存。成否を返す |
| `cancelPendingSaves()` | デバウンスと再試行の両タイマーを止める |

`startNewSession()` / `loadSessionById()` は `state.session` を差し替える前に `cancelPendingSaves()` を呼び、**旧セッション宛の遅延保存・再試行が新セッションに化けないようにしている**。

**表示**（`#saveStatus`・ツールバー行2の末尾）: `saved`→「保存済み HH:MM」/ `saving`→「保存中…」/ `unsaved`→「⚠ 未保存（再試行中）」/ `offline`→「⚠ 共有サーバに接続できません」。後者2つは `.warn` クラスで赤字になる。

#### 保存失敗時にデータを失わないためのガード

`saveSession` が成否を返さなかった頃は、**保存に失敗しても画面が先に進んでしまい、メモリ上にしか無い未保存分が失われていた**。以下は「失敗したら進まない」ためのガードであり、単なる表示の問題ではない:

- **「保存して新規」**（`newDialog` の `save`）: `flushSave()` が `false` なら `startNewSession()` を呼ばず `alert()` で通知。旧セッションはそのまま残り、再試行で復旧する
- **`loadSessionById()`**: `flushSave()` が `false` なら切替を中止
- **`saveCurrent()`**（途中保存）: 失敗時に「保存しました」と表示しない
- **`beforeunload`**: `saveState === 'unsaved'` のときだけ離脱を引き止める（最後の入力が失敗したまま端末を置いて立ち去るのを防ぐ）

### 9-5. 再描画

**差分更新はしない。** `render()` が `renderGrid()`（`replaceChildren` でテーブル丸ごと再構築）と `renderStats()`（全カード再構築＋全 canvas 再描画）を毎回呼ぶ。値を1つ入れるたびにグリッドと統計が全て作り直される。

フォーカスが飛ばないのは、`grid.ts` が DOM 置換後に `input[data-row][data-col]` を引き直して `focus()` / `select()` するため（`document.activeElement` と一致する場合はスキップして自分自身からフォーカスを奪わない）。

### 9-6. 起動シーケンス（`main.ts: init`）

1. `await initTemplates()` — サーバからテンプレを取得してキャッシュへ。**戻り値がサーバ到達性のヘルスチェックを兼ねる**
2. `state` を構築
3. テンプレが0件なら `sampleTemplate()` を保存
4. `getCurrentSessionId()` → `getSession(id)` でセッション復元。無ければ先頭テンプレから新規作成
5. `syncTemplateUi()` / `render()`
6. 保存ステータスの初期化 — 到達不可なら `offline`、復元できたなら（サーバから読めた＝保存済みなので）`saved`、新規作成したなら `doSave()` して結果を表示
7. イベント配線、設定値をコントロールへ反映
8. `isVoiceSupported()` が false なら音声ボタンを無効化し「手入力で利用可」と案内
9. `syncTopbarHeight()` でツールバー実測高を CSS 変数 `--topbar-h` に設定（`ResizeObserver` + `resize` で追従）

### 9-7. テンプレートの表示（「測定中」と品番セレクトの分離）

**品番セレクトを変えてもテンプレは切り替わらない。** 適用は「新規測定」ボタンが `startNewSession()` で行う。測定中に誤ってシートを作り直さないための設計。

つまり**品番セレクトは「シートの状態」ではなく「次に新規測定／テンプレ編集で使う対象」**であり、両者は食い違いうる。かつては画面上にセッションのテンプレートが一切出ておらず（表示は読み込みダイアログと .xlsx 出力のみ）、セレクトが状態表示に見えて混乱の原因になっていた。そこで両者を分けている:

| 表示 | 情報源 | 意味 |
|---|---|---|
| ツールバー行2「測定中 …」（`#sheetTemplate`） | **`state.session`** | 今のシートが使っているテンプレート。**常に正しい** |
| 行1の品番セレクト（`#partSelect`） | `listTemplates()` | 次に新規測定／編集で使う対象 |
| 行1の注記（`#partSelectNote`） | 両者の差 | 食い違っていれば「未適用（「新規測定」で適用）」 |

同期は **`syncTemplateUi()` に集約**されており、内部で `syncSheetHeader()` と `syncPartSelectNote()` を呼ぶ。呼び出しは「セッションを差し替えたとき」と「テンプレ一覧が変わったとき」— `init` / `startNewSession` / `loadSessionById` / テンプレ保存・削除・取込。**`render()` からは呼ばない**（`render()` は入力のたびに走るが `getTemplate()` は localStorage を `JSON.parse` するため）。

**テンプレート削除の検出**: 現セッションのキーに一致するテンプレが無い場合、`syncTemplateUi()` はセレクト先頭に `disabled` のプレースホルダ（`(削除済み) …`）を立てて選択する。これが無いとブラウザ既定で option 0 が選ばれ、**セレクトが無関係なテンプレートを指して詐称する**。「測定中」側にも「（削除済み）」を付けて警告色にする。

なお `Session.items` はスナップショットなので（§4）、**テンプレートを編集しても開いているシートは古い公差で判定し続ける**。この検出は未実装（§13）。

---

## 10. Excel 出力仕様（`exportXlsx.ts`）

`XLSX.writeFile()` でブラウザのダウンロードを直接発火。ファイル名は `測定_{品番}_{YYYY-MM-DD}.xlsx`。

配列(AoA)のみで構築し、**セル書式・列幅・結合は一切設定しない**。

### シート1「測定表」

列構成は `No.` +（値, 判定）× 項目数 = **`1 + 2n` 列**（画面のグリッドで項目見出しが `colSpan=2` なのと対応）。

| 行 | 内容 |
|---|---|
| 1 | `品番: {partNo}` / `{name}` / `日付: {YYYY-MM-DD}` |
| 2 | `No.` / `{label}({unit})` / `判定` / … |
| 3 | `` / `{toleranceLabel(it)}` / `` / …（公差は値列の下、判定列は空） |
| 4〜 | `{i+1}` / `{value ?? null}` / `{judgment ?? ''}` / … |

値が無いセルは `null`（空セル）で書く。文字列 `''` にすると数値列に文字が混ざるため。

### シート2「工程能力」

固定9列。目視項目も行として出力される（統計は空になる）。

| 列 | 値 | 丸め |
|---|---|---|
| 測定項目 | `it.label` | — |
| 下限 / 上限 | `it.lower` / `it.upper`（**公差ではなく LSL/USL**） | 生値 |
| n | `s.n` | 整数 |
| 平均 | `s.mean` | **3桁** |
| σ | `s.sigma` | **4桁** |
| Cp / Cpk | `s.cp` / `s.cpk` | 3桁 |
| NG数 | `s.ngCount` | 整数 |

算出不能な統計（n<2、σ=0、規格なし）は**空セル**になる（`round()` が `null`/`NaN` に `''` を返す）。

統計は画面表示を再利用せず `columnStats()` で**再計算**する。角度の平均は `formatAngle` を通さず**10進度の生値**で出力される（画面のカードとは表示が異なる）。

### 制約

> **無償版 SheetJS はセル背景色の書き込みに未対応**。そのため NG は判定列の `"NG"` という文字で表現している。色分けは Excel 側の条件付き書式で行う想定。

---

## 11. ブラウザ要件・PWA

| API | 用途 | 備考 |
|---|---|---|
| Web Speech API | 音声認識 | **Edge/Chrome のみ・ネット必須**。`lang='ja-JP'` / `continuous` / `interimResults` / `maxAlternatives=1`。**唯一の feature gate** — 非対応なら音声ボタンを無効化して手入力に degrade |
| SpeechSynthesis | 読み返し・NG通知 | `lang='ja-JP'` / `rate=1.1`。発話前に `cancel()` して被りを防ぐ |
| Web Audio | NG警告音 | `beep()` = **880Hz / 220ms / 矩形波 / gain 0.08**。`AudioContext` はモジュールレベルの遅延生成シングルトン |
| `crypto.randomUUID()` | セッション・項目ID | **secure context 必須（HTTPS または localhost）** |
| `<dialog>` + `showModal()` | 各ダイアログ | ポリフィルなし |
| `ResizeObserver` | ツールバー高の追従 | feature 検出あり |
| Canvas 2D | ヒストグラム | null ガードあり |
| `fetch` / `localStorage` | 永続化 | — |

結果として **HTTPS + Chromium系 + ネットワーク接続**が実運用の前提になる。

### PWA

`manifest.webmanifest` で `display: standalone`、アイコンは `public/icons/`（192 / 512 / maskable-512）。

**Service Worker は存在しない。** インストール可能なだけで**オフライン動作はしない**。音声認識もAPIもネット必須なので、現状の要件とは整合している。オフライン対応を足すなら SW の追加だけでは足りず、音声エンジンとデータ同期の両方を設計し直す必要がある。

---

## 12. テスト

```powershell
npm test        # Vitest 82件
npm run build   # tsc の型チェック + 本番ビルド
```

| ファイル | 対象 |
|---|---|
| `template.test.ts` | 公差計算、複合キー、`templateLabel()` の表示名組み立て、旧形式の自動移行、JSON往復、取込時の `upper` 再計算 |
| `store.test.ts` | `fetch` をモックし、**成功/500/ネット断で `saveSession` の戻り値**、全量PUTであること、復帰後の再送、`vms.currentSessionId` の記録/削除 |
| `settings.test.ts` | 4設定の既定値と往復 |
| `stats.test.ts` | 平均/σ/Cp/Cpk と境界条件 |
| `angle.test.ts` | DMS往復、秒の桁上がり、`parseAngle` の5構文 |
| `numberParser.test.ts` | 数値正規化、漢数字、コマンド、**ゆっくり入力の断片連結** |
| `format.test.ts` | 公差ラベル（旧形式の上下限のみ表示を含む） |
| `histogram.test.ts` | ビン幅の決定 |

テストは localStorage を `Map` ベースのモックで差し替える。`template.ts` の `canSync()` が `typeof window`/`fetch` を見ているため、**node環境のテストではサーバ同期が自動的にスキップ**される。

**自動テストが無い領域**（正直に記す）: `api/` 全体、`main.ts`（UI配線・カーソル前進・NG停留・デバウンス・保存ステータス・再試行）、`recognizer.ts`（ブラウザAPIグルー）。`store.ts` は単体テストが入ったが、**サーバ側（`api/`）の自動カバレッジは依然ゼロ。**

---

## 13. 既知の制約・技術的負債

改修時に踏む地雷。優先度順ではなく分類順。

### 整合性

- **`templateKey()` が2箇所に重複実装されている** — `src/template.ts` と `api/templates/index.js`。片方だけ変えるとクライアントとサーバでIDが食い違い、テンプレが二重登録される。**必ず両方を揃えること。**
- `SEP = '␟'` のコメントは「制御文字 U+241F / UNIT SEPARATOR」とあるが、実体は**印字可能な記号 U+241F（SYMBOL FOR UNIT SEPARATOR）**であって C0制御文字 U+001F ではない。通常入力されない点は変わらないので実害は無いが、コメントは不正確。
- エクスポート JSON の `schema` / `version` は**書き出すだけで、取り込み時に検証もマイグレーションもしていない**。将来 version 2 を作るなら移行経路をここに足す必要がある。

### 動作

- **取込 `mode: 'replace'` はサーバ側を削除しない**（コード中にも「簡易実装」と明記）。ローカルを全置換しても次回 `initTemplates()` でサーバから復活する。
- `getSession()` / `listSessions()` の失敗は今も UI に出ない（`undefined` / `[]` を返すだけ）。読み込み一覧が「保存データはありません」と表示されたとき、**本当に無いのか通信できていないのかを区別できない**。保存側は §9-4 で解決済み。
- **テンプレート編集の検出が無い** — `Session.items` はスナップショットのため、テンプレの公差を変更しても**開いているシートは古い公差で判定し続ける**。`Session` に版情報が無く、`state.session.items` と `getTemplate(...)?.items` を比較する処理も無い。削除の検出は §9-7 で入れたが、編集の検出は未実装。工程能力の測定器としては重要度が高い。
- `listSessions()` は**全セッションを無制限に取得**する（`ORDER BY c.date DESC` の全件フェッチ）。TTL も件数上限も枝刈りも無いため、読み込みダイアログを開くたびに全件がメモリに載る。

### 構成

- 単一論理パーティション（`partitionKey` が全件 `'shared'`）は共有要件に対する意図的な単純化だが、スケール上限がある。
- **`manifest.webmanifest` の `icons[].src` が絶対パス `/icons/...`** で、`base: './'`（相対パス配置可）という設計意図と矛盾する。現在のルート配置では問題ないが、サブパスへ配置するとアイコンだけ404になる。

### コード品質

- **「メートル」を含む単位が解釈できない（実バグ）** — 詳細は §8-6 の注記を参照。`parseNumber('12.3ミリメートル')` は `null` を返す。
- `voice/numberParser.ts` の `NOISE` にある `ミリ?メートル` は、`?` が `リ` にのみ掛かるため**そもそも「メートル」単独には一致しない**（`ミ` + 任意の `リ` + `メートル` の意味）。`(ミリ)?メートル` の書き間違いと思われる。また `メートル` 単独・`m` 単独は除去対象に入っていない。
- `parseCommand` の `confirm` にある `ok確定` は到達不能（同じ正規表現内で `確定` が先に一致する）。
- `angle.ts` が全角→半角の変換表を `numberParser.ts` から**複製**して持っている（内容は同一、宣言は別）。
- `Recognizer.listening` は**希望状態**（`wantListening`）を返し、エンジンの実状態ではない。自動再起動の隙間でも `true` を返す。
- `openTemplateEditor()` は約224行あり `main.ts` 最大の関数。テンプレ編集のCRUD・DOM生成・並べ替えが1関数に同居している。

---

## 付録: 主要な定数

| 定数 | 値 | 場所 | 意味 |
|---|---|---|---|
| `SLOW_COMMIT_MS` | 1200 | `main.ts` | ゆっくり入力の無音→自動確定 |
| （autosave） | 400 | `main.ts` | 自動保存のデバウンス |
| `MAX_BINS` | 300 | `histogram.ts` | ヒストグラムのビン数上限 |
| canvas | 240×90 | `main.ts` | ヒストグラム解像度 |
| `beep` | 880Hz / 220ms | `voice/recognizer.ts` | NG警告音 |
| TTS `rate` | 1.1 | `voice/recognizer.ts` | 読み上げ速度 |
| Cpk 水準 | 1.33 / 1.0 | `stats.ts` | 十分 / 要注意 の閾値 |
| `SEP` | `␟` | `template.ts`, `api/templates/index.js` | テンプレ複合キーの区切り |
| `PK` | `'shared'` | `api/shared/cosmos.js` | 全ドキュメント共通パーティションキー |
