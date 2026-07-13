# 共有ストレージ API (Azure Functions)

テンプレートと測定セッションを Cosmos DB に保存し、ログインした全員で共有するための API。
Azure Static Web Apps のマネージド Functions として `/api` にデプロイされる。

## エンドポイント
- `GET  /api/templates` … 全テンプレート
- `POST /api/templates` … テンプレート1件 upsert（body: Template）
- `DELETE /api/templates/{key}` … テンプレート1件削除（key = 品番␟品名␟工程 を URL エンコード）
- `GET  /api/sessions` … 全セッション（date 降順）
- `GET  /api/sessions/{id}` … 1件取得
- `PUT  /api/sessions/{id}` … 1件保存(upsert)
- `DELETE /api/sessions/{id}` … 1件削除

DB(`vms`) とコンテナ(`templates`/`sessions`, partitionKey `/partitionKey`)は初回アクセス時に自動作成される。

## 必要な設定
接続文字列を環境変数 `COSMOS_CONNECTION_STRING` に設定する。
- 本番: Azure ポータル → 対象の Static Web App → 設定 → 構成（アプリケーション設定）に追加。
- ローカル: `api/local.settings.json`（gitignore 済み）に記載。

```jsonc
// api/local.settings.json（ローカル開発用・コミットしない）
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "COSMOS_CONNECTION_STRING": "AccountEndpoint=https://...;AccountKey=...;"
  }
}
```

## ローカル実行
`npm i -g @azure/static-web-apps-cli azure-functions-core-tools@4` を入れ、リポジトリ直下で:

```
npm run build            # フロント(dist)を生成
swa start dist --api-location api
```

`http://localhost:4280` でフロント＋API を一緒に動かせる（Cosmos は実アカウントかエミュレータが必要）。
