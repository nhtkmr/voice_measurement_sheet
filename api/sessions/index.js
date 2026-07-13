// GET /api/sessions … 全セッションを日時降順で取得
const { getContainer, strip } = require('../shared/cosmos');

module.exports = async function (context, req) {
  try {
    const c = await getContainer('sessions');
    const { resources } = await c.items
      .query('SELECT * FROM c ORDER BY c.date DESC')
      .fetchAll();
    context.res = { status: 200, body: resources.map(strip) };
  } catch (e) {
    context.log.error('sessions list error:', e);
    context.res = { status: 500, body: { error: String((e && e.message) || e) } };
  }
};
