# デプロイ / 運用ガイド（AWS / Azure）

工程能力 音声測定シート（`voice-measurement-sheet`）をクラウドで運用するための手順書です。

---

## 0. 前提：このアプリの性質

このアプリは **100% クライアントサイドの静的PWA** です。

- ビルドすると `dist/` に **静的ファイル（HTML/JS/CSS）だけ** が出力されます。
- **サーバ・API・データベースは不要**。動かすのは「静的ファイルを HTTPS で配信するだけ」。
- 測定データは **各端末・各ブラウザのローカル**（IndexedDB + localStorage）に保存されます。

### 運用前に必ず押さえる 3 つの制約

1. **HTTPS 必須**
   マイク（Web Speech API）と PWA は secure context（HTTPS、または `localhost`）でしか動きません。
   **HTTP で配信すると音声入力が使えません。** 以下で紹介するマネージドサービスは HTTPS が自動で付きます。

2. **音声はインターネット必須 ＆ Chrome / Edge 限定**
   音声認識はブラウザ（Chrome/Edge）のクラウド音声認識を利用します。
   **社内ネットワークが外部インターネットを遮断していると音声入力が動かない可能性** があります。
   完全オフライン運用が必要な場合は将来的に音声エンジンの差し替えが必要です（`src/voice/recognizer.ts` は差し替え可能な設計）。

3. **データは端末ローカル保存・端末間同期なし**
   ブラウザのデータ削除・端末故障でデータは消えます。
   バックアップ・共有はアプリ内の **「テンプレ書出」「Excel出力」** 機能で運用してください。
   （複数端末でのデータ共有が必要になった場合は、別途クラウドDB＋認証APIの追加が必要 = 今回はスコープ外）

---

## 1. 共通：ビルド

ローカルでもCIでも同じです。

```bash
npm ci
npm run build       # tsc && vite build
```

- 出力先：`dist/`（`vite.config.ts` の `build.outDir`）
- **公開対象は `dist/` の中身** です。
- `vite.config.ts` は `base: './'`（相対パス）なので、ルート直下でもサブパスでも配置できます。
- 単一ページ構成（クライアントルーティングなし）なので、特殊な SPA リライト設定は不要です。

ローカル動作確認：

```bash
npm run preview     # dist/ を配信。ブラウザで音声・Excel出力・テンプレ保存を確認
```

---

## 2. Azure（最推奨）：Azure Static Web Apps

無料枠があり、HTTPS・CI/CD・認証が組み込みで、社内限定公開が最も簡単です。

### 2-1. GitHub 連携で作成（推奨）

1. コードを GitHub リポジトリに push（git 未初期化なら `git init` → commit → push）。
2. Azure ポータル → 「**Static Web Apps**」→ 作成。
3. デプロイ詳細：
   - **App location**: `/`
   - **Api location**: （空欄）
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
  --output-location "dist" \
  --login-with-github
```

### 2-3. 社内限定公開（Entra ID 認証）

本リポジトリ同梱の **`staticwebapp.config.json`** が、全ルートを `authenticated` ロール必須にし、未認証は Entra ID（`/.auth/login/aad`）へリダイレクトする設定になっています。

- 既定の Entra ID プロバイダで「サインインできた人だけ」に絞れます。
- **特定ユーザーのみに限定** したい場合は、Static Web Apps の「ロール管理」で招待リンクを発行し、許可ユーザーにロールを付与してください。
- **IP アドレスで制限** したい場合は **Standard プラン** が必要（ネットワーク制限機能 / Private Endpoint）。社内グローバルIPのみ許可する運用が可能です。
- `staticwebapp.config.json` には併せてセキュリティヘッダと `Permissions-Policy: microphone=(self)` も設定済みです。

---

## 3. AWS（マネージドで簡単）：AWS Amplify Hosting

HTTPS・CI/CD が自動。**組み込みの Basic 認証** で限定公開が最も簡単です。

### 3-1. 作成手順

1. コードを GitHub/CodeCommit 等に push。
2. AWS コンソール → **Amplify** → 「アプリをホスト」→ リポジトリ接続。
3. ビルド設定は本リポジトリ同梱の **`amplify.yml`** が使われます（`npm ci` → `npm run build`、`baseDirectory: dist`）。
4. デプロイ完了で `https://main.xxxx.amplifyapp.com` が HTTPS で払い出されます。

### 3-2. 社内限定公開（Basic 認証）

- Amplify コンソール → 対象アプリ → 「**Access control**（アクセスコントロール）」→ ブランチに対して **ユーザー名／パスワード** を設定。
- これだけで「パスワードを知っている人だけ」のシンプルな限定公開になります。
- より厳密な認証（社内IdP連携）が必要なら、次の CloudFront 構成 + Cognito を検討。

---

## 4. AWS 代替：S3 + CloudFront + WAF（IPアドレス制限したい場合）

「社内のグローバルIPからのみアクセス可」を実現したい場合の構成です。

1. **S3 バケット作成**：`dist/` の中身をアップロード（`aws s3 sync dist/ s3://<bucket> --delete`）。
   - バケットは非公開のまま、CloudFront からのみ参照（OAC: Origin Access Control）。
2. **ACM 証明書**：`us-east-1` で独自ドメイン用の証明書を発行（CloudFront 用）。
3. **CloudFront ディストリビューション**：
   - オリジン = S3（OAC）
   - **Default root object** = `index.html`
   - ビューワープロトコルポリシー = **Redirect HTTP to HTTPS**
   - `base: './'` かつ単一ページなので **SPA 用のカスタムエラー応答（403/404 → index.html）は不要**。
4. **AWS WAF**：
   - IP セット（許可リスト）に社内グローバルIPを登録。
   - Web ACL の既定アクションを **Block**、IPセット一致のみ **Allow** にして CloudFront に関連付け。

更新フロー（例）：

```bash
npm run build
aws s3 sync dist/ s3://<bucket> --delete
aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"
```

---

## 5. クラウド別の選び方

| 条件 | 推奨 |
|---|---|
| とにかく簡単・無料で始めたい | **Azure Static Web Apps**（認証組込み・無料枠） |
| AWS 縛りで、簡単に限定公開したい | **AWS Amplify Hosting**（Basic 認証） |
| AWS で「社内IPのみ許可」を厳密にやりたい | **S3 + CloudFront + WAF** |
| 社内の Entra ID / Azure AD でログイン制御したい | **Azure Static Web Apps**（同梱 `staticwebapp.config.json`） |

---

## 6. デプロイ後の動作確認チェックリスト

- [ ] `https://...` で開ける（HTTP ではないこと）
- [ ] Chrome / Edge で「🎤 音声開始」→ マイク許可 → 数値が入力される
- [ ] アクセス制限が効く（未認証 / 社外IPからはブロックされる）
- [ ] 「Excel出力」でファイルがダウンロードできる
- [ ] 「テンプレ書出 / 取込」でJSONの入出力ができる
- [ ] リロードしても直前のセッションが復元される（IndexedDBローカル保存の確認）
- [ ] PWA としてインストールできる（`manifest.webmanifest` が読まれる）

---

## 7. 運用上の注意・将来課題

- **PWAアイコン未設定**：`manifest.webmanifest` の `icons` が空です。インストール時のアイコンを表示したい場合は事前に追加してください（必須ではない）。
- **データ共有**：端末間でデータ共有が必要になったら、クラウドDB（Cosmos DB / DynamoDB）＋ 認証API の追加が必要です（今回はスコープ外）。
- **完全オフライン運用**：社内ネット遮断環境で音声を使うには、Web Speech API → Vosk 等オフラインエンジンへの差し替えが必要です（`src/voice/recognizer.ts` が差し替え可能な構造）。
