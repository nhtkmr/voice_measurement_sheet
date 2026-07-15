# デプロイ / 運用ガイド（Azure）

工程能力 音声測定シート（`voice-measurement-sheet`）をクラウドで運用するための手順書です。

---

## 0. 前提：このアプリの性質

このアプリは **静的SPA ＋ 統合API ＋ データベース** の3点セットで動きます。
**静的ファイルを配信するだけでは動きません**（保存機能がすべて失敗します）。

- `dist/` に静的ファイル（HTML/JS/CSS）が出力される。
- 加えて `api/`（**Azure Functions・Node 20**）と **Cosmos DB** が必要。
- 測定データもテンプレートも **サーバ（Cosmos DB）に保存され、ログインした全員で共有** される。

現状は **Azure Static Web Apps 前提**の構成です（静的配信・認証・API・CI/CD が1サービスに収まるため）。

### 運用前に必ず押さえる 4 つの制約

1. **HTTPS 必須**
   マイク（Web Speech API）と PWA、`crypto.randomUUID()` は secure context（HTTPS、または `localhost`）でしか動きません。
   **HTTP で配信すると音声入力もセッション生成も動きません。** 以下のマネージドサービスは HTTPS が自動で付きます。

2. **音声はインターネット必須 ＆ Chrome / Edge 限定**
   音声認識はブラウザ（Chrome/Edge）のクラウド音声認識を利用します。
   **社内ネットワークが外部インターネットを遮断していると音声入力が動かない可能性** があります。
   完全オフライン運用が必要な場合は将来的に音声エンジンの差し替えが必要です（`src/voice/recognizer.ts` は差し替え可能な設計）。

3. **データはチーム全員で共有・ログイン必須**
   ユーザーごとのデータ分離はありません。サインインできた人は全員が同じテンプレート・測定データを見て編集できます。
   同梱の `staticwebapp.config.json` が全ルート（`/api/*` を含む）を `authenticated` 必須にしています。

4. **`COSMOS_CONNECTION_STRING` の設定が必須**
   未設定だと API が 500 を返し、**アプリは起動するのに保存だけが黙って失敗します**（現状 UI に警告は出ません）。
   デプロイ後は必ず §6 のチェックリストで保存を確認してください。

> API 側の関数は `authLevel: "anonymous"` ですが、これは無防備という意味ではありません。
> 認証は SWA のルート認可が前段で行っています。**SWA 以外に配置すると API は無認証で露出します。**

---

## 1. 共通：ビルド

ローカルでもCIでも同じです。

```bash
npm ci
npm run build       # tsc && vite build
```

- 出力先：`dist/`（`vite.config.ts` の `build.outDir`）
- **公開対象は `dist/` の中身 ＋ `api/`** です（`api/` はビルド不要。SWA が Functions として取り込む）。
- `public/` の中身（`staticwebapp.config.json`・`icons/`）は `dist/` へ自動コピーされます。
- `vite.config.ts` は `base: './'`（相対パス）なので、原則サブパスにも配置できます
  （ただし `manifest.webmanifest` のアイコンパスが絶対のため、サブパス配置ではアイコンのみ404になります）。
- 単一ページ構成（クライアントルーティングなし）なので、特殊な SPA リライト設定は不要です。

ローカル動作確認：

```bash
npm run preview     # dist/ を配信。音声・Excel出力の確認用
```

> **`npm run preview` は静的ファイルしか配信しません**（`/api/*` は 404）。
> テンプレート・測定データの保存を含めて確認したい場合は、
> Azure Static Web Apps CLI（`swa start`）を使うか、デプロイ先で確認してください。

---

## 2. Azure（本番構成）：Azure Static Web Apps

無料枠があり、HTTPS・CI/CD・認証・API が組み込みで、社内限定公開が最も簡単です。

### 2-1. GitHub 連携で作成（推奨）

1. コードを GitHub リポジトリに push（git 未初期化なら `git init` → commit → push）。
2. Azure ポータル → 「**Static Web Apps**」→ 作成。
3. デプロイ詳細：
   - **App location**: `/`
   - **Api location**: `api` ← **空欄にすると共有ストレージが動きません**
   - **Output location**: `dist`
4. 作成すると **GitHub Actions ワークフローが自動生成** され、push のたびに自動ビルド＆デプロイされます。
5. 払い出される `https://<name>.azurestaticapps.net` で HTTPS 公開されます。

### 2-2. CLI で作成する場合

```bash
az staticwebapp create \
  --name vms-app \
  --resource-group <RG名> \
  --source https://github.com/<org>/<repo> \
  --branch main \
  --app-location "/" \
  --api-location "api" \
  --output-location "dist" \
  --login-with-github
```

### 2-3. Cosmos DB の用意と接続（必須）

1. Cosmos DB アカウント（NoSQL API）を作成。**データベース・コンテナは手動作成不要** —
   初回アクセス時に `api/shared/cosmos.js` が `createIfNotExists` で自動作成します
   （DB `vms` / コンテナ `templates`・`sessions`、パーティションキー `/partitionKey`）。
2. 接続文字列をコピーし、**Static Web Apps → 「構成」→ アプリケーション設定**に登録：

   | 名前 | 値 |
   |---|---|
   | `COSMOS_CONNECTION_STRING` | Cosmos DB の接続文字列（プライマリ） |

3. 保存後、API が再起動されて共有ストレージが有効になります。

```bash
# CLI で設定する場合
az staticwebapp appsettings set --name vms-app \
  --setting-names COSMOS_CONNECTION_STRING="<接続文字列>"
```

> **未設定のまま公開すると**、画面は正常に開くのにテンプレートが空になり、
> 測定データの保存が黙って失敗します。最も気付きにくい設定ミスです。

### 2-4. 社内限定公開（Entra ID 認証）

本リポジトリ同梱の **`public/staticwebapp.config.json`** が、全ルートを `authenticated` ロール必須にし、未認証は Entra ID（`/.auth/login/aad`）へリダイレクトする設定になっています。

- 既定の Entra ID プロバイダで「サインインできた人だけ」に絞れます。
- **特定ユーザーのみに限定** したい場合は、Static Web Apps の「ロール管理」で招待リンクを発行し、許可ユーザーにロールを付与してください。
- **IP アドレスで制限** したい場合は **Standard プラン** が必要（ネットワーク制限機能 / Private Endpoint）。社内グローバルIPのみ許可する運用が可能です。
- 併せてセキュリティヘッダ・`Permissions-Policy: microphone=(self)`・`platform.apiRuntime: node:20` も設定済みです。

> **このファイルは `public/` 配下に置く必要があります。**
> Vite は `public/` の中身を `dist/` へコピーするため、リポジトリのルートに置くと
> ビルド出力に入らず、配信されず、**認証が一切掛からないまま公開されます**。移動させないでください。

---

## 3. 他ホスティングへの移行について（AWS 等）

**現構成は Azure Functions + Cosmos DB に依存しているため、静的配信だけのホスティングでは動きません。**
画面は開けますが `/api/*` が 404 になり、テンプレートが空になって測定データの保存が黙って失敗します。

移行する場合は、静的配信の設定に加えて **バックエンドの移植が別途必要** です：

| 現行（Azure） | 移行時に用意するもの |
|---|---|
| Azure Functions (`api/`) | Lambda + API Gateway 等（`api/` を4エンドポイント分ポート） |
| Cosmos DB | DynamoDB 等（`api/shared/cosmos.js` 相当の書き換え） |
| SWA の Entra ID 認証（`/*` を `authenticated` に強制） | Amplify の Basic 認証 / CloudFront + Cognito 等。**API パスも必ず保護すること** |

参考として、リポジトリには AWS Amplify 用の `amplify.yml`（`npm ci` → `npm run build`、`baseDirectory: dist`）が残っていますが、
これは**静的部分のビルド設定のみ**で、上記のバックエンドは含みません。

> かつて併存していた GitHub Pages 配信（`.github/workflows/deploy.yml`）は、まさにこの理由で機能しなくなったため廃止しました。
> 静的配信だけのホスティングを追加する際は、同じ轍を踏まないよう API の移植までをセットで検討してください。

---

## 4. デプロイ後の動作確認チェックリスト

- [ ] `https://...` で開ける（HTTP ではないこと）
- [ ] アクセス制限が効く（未認証 / 社外IPからはブロックされる）
- [ ] Chrome / Edge で「🎤 音声開始」→ マイク許可 → 数値が入力される
- [ ] **ツールバー右端に「保存済み HH:MM」が出ている**
      → 「⚠ 共有サーバに接続できません」なら `COSMOS_CONNECTION_STRING` 未設定を疑う（`/api/templates` が 500 を返しているはず）
- [ ] **測定値を入れてリロード → 復元される**（サーバ保存の確認）
- [ ] **別の端末／別のブラウザでログイン → 同じテンプレート・同じセッションが見える**（共有の確認）
- [ ] 「Excel出力」でファイルがダウンロードできる
- [ ] 「テンプレ書出 / 取込」でJSONの入出力ができる
- [ ] PWA としてインストールできる（`manifest.webmanifest` が読まれる）

> 保存の成否はツールバー右端の保存ステータスに出ます。**赤字の警告が出ていないこと**を確認してください。

---

## 5. 運用上の注意・将来課題

- **保存できない状態は画面に出ます**：`COSMOS_CONNECTION_STRING` 未設定やネットワーク断のときは、
  ツールバー右端に「⚠ 未保存（再試行中）」「⚠ 共有サーバに接続できません」が赤字で出ます。
  自動で再試行し続けるので、通信が復帰すれば操作なしで保存されます。
  この状態では新規測定への切替や別セッションの読み込みが中止されます（未保存分の消失を防ぐため）。
- **データはチーム全員で共有**：ユーザーごとの分離はありません。誰でも他人の測定データを編集・削除できます。
- **セッションの枝刈りが無い**：件数上限も TTL も無く、読み込みダイアログを開くたびに全件を取得します。
  長期運用で件数が増えると重くなります。
- **完全オフライン運用**：社内ネット遮断環境で音声を使うには、Web Speech API → Vosk 等オフラインエンジンへの差し替えが必要です（`src/voice/recognizer.ts` が差し替え可能な構造）。
  なお Service Worker が無いため、現状はインストールできてもオフラインでは動きません。

> 内部設計・既知の負債の詳細は **[docs/SPEC.md](docs/SPEC.md)** を参照。
