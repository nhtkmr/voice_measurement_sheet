// Cosmos DB 接続の共有ヘルパー。
// 接続文字列は SWA のアプリケーション設定 COSMOS_CONNECTION_STRING から読む。
// DB / コンテナは初回アクセス時に自動作成する（手動作成不要）。
const { CosmosClient } = require('@azure/cosmos');

const CONN = process.env.COSMOS_CONNECTION_STRING;
const DB_ID = 'vms';

/** 全ドキュメント共通のパーティションキー値（データはチーム全員で共有） */
const PK = 'shared';

let client = null;
const containers = {};

/** 指定コンテナ（無ければ作成）を返す。 */
async function getContainer(id) {
  if (!CONN) throw new Error('COSMOS_CONNECTION_STRING is not set');
  if (!client) client = new CosmosClient(CONN);
  if (!containers[id]) {
    const { database } = await client.databases.createIfNotExists({ id: DB_ID });
    const { container } = await database.containers.createIfNotExists({
      id,
      partitionKey: { paths: ['/partitionKey'] },
    });
    containers[id] = container;
  }
  return containers[id];
}

/** Cosmos のシステム項目とパーティションキーを除去してクライアント向けに整形する。 */
function strip(doc) {
  if (!doc) return doc;
  const { partitionKey, _rid, _self, _etag, _attachments, _ts, ...rest } = doc;
  return rest;
}

module.exports = { getContainer, strip, PK };
