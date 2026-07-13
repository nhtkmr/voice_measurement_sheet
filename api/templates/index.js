// GET  /api/templates  … 全テンプレート取得
// POST /api/templates  … テンプレート1件を upsert（body: Template）
const { getContainer, strip, PK } = require('../shared/cosmos');

// クライアント(src/template.ts)と同じ複合キー生成（品番␟品名␟工程）
const SEP = '␟';
function templateKey(t) {
  return `${t.partNo}${SEP}${t.name || ''}${SEP}${t.process || ''}`;
}

module.exports = async function (context, req) {
  try {
    const c = await getContainer('templates');

    if (req.method === 'GET') {
      const { resources } = await c.items.readAll().fetchAll();
      context.res = { status: 200, body: resources.map(strip) };
      return;
    }

    // POST
    const t = req.body;
    if (!t || typeof t.partNo !== 'string' || t.partNo.trim() === '') {
      context.res = { status: 400, body: { error: 'partNo is required' } };
      return;
    }
    const id = templateKey(t);
    await c.items.upsert({ id, partitionKey: PK, ...t });
    context.res = { status: 200, body: { ok: true, id } };
  } catch (e) {
    context.log.error('templates error:', e);
    context.res = { status: 500, body: { error: String((e && e.message) || e) } };
  }
};
