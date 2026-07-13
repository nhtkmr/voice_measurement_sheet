// GET    /api/sessions/{id} … 1件取得
// PUT    /api/sessions/{id} … 1件保存(upsert)
// DELETE /api/sessions/{id} … 1件削除
const { getContainer, strip, PK } = require('../shared/cosmos');

module.exports = async function (context, req) {
  try {
    const id = context.bindingData.id;
    const c = await getContainer('sessions');

    if (req.method === 'GET') {
      try {
        const { resource } = await c.item(id, PK).read();
        if (!resource) {
          context.res = { status: 404, body: { error: 'not found' } };
          return;
        }
        context.res = { status: 200, body: strip(resource) };
      } catch (e) {
        if (e && e.code === 404) {
          context.res = { status: 404, body: { error: 'not found' } };
          return;
        }
        throw e;
      }
      return;
    }

    if (req.method === 'PUT') {
      const s = req.body;
      if (!s || typeof s !== 'object') {
        context.res = { status: 400, body: { error: 'session body required' } };
        return;
      }
      // ルートの id を正としてドキュメントIDに揃える
      await c.items.upsert({ ...s, id, partitionKey: PK });
      context.res = { status: 200, body: { ok: true, id } };
      return;
    }

    // DELETE
    try {
      await c.item(id, PK).delete();
    } catch (e) {
      if (!(e && e.code === 404)) throw e;
    }
    context.res = { status: 200, body: { ok: true } };
  } catch (e) {
    context.log.error('sessions-item error:', e);
    context.res = { status: 500, body: { error: String((e && e.message) || e) } };
  }
};
