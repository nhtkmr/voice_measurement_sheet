// DELETE /api/templates/{key}  … テンプレート1件を削除
const { getContainer, PK } = require('../shared/cosmos');

module.exports = async function (context, req) {
  try {
    const key = context.bindingData.key;
    const c = await getContainer('templates');
    try {
      await c.item(key, PK).delete();
    } catch (e) {
      if (e && e.code === 404) {
        context.res = { status: 204 };
        return;
      }
      throw e;
    }
    context.res = { status: 200, body: { ok: true } };
  } catch (e) {
    context.log.error('templates-delete error:', e);
    context.res = { status: 500, body: { error: String((e && e.message) || e) } };
  }
};
