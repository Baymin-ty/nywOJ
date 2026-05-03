const handler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    if (res.headersSent) return;
    const message = err && err.sqlMessage ? err.sqlMessage : err && err.message ? err.message : String(err);
    console.error('handler error:', err && err.stack ? err.stack : err);
    res.status(202).send({ message });
  }
};

const fail = (res, message, status = 202) => res.status(status).send({ message });
const ok = (res, payload = { message: 'success' }) => res.status(200).send(payload);

const paginate = (req, defaultSize = 20) => {
  let pageId = parseInt(req.body.pageId, 10);
  if (!pageId || pageId < 1) pageId = 1;
  const pageSize = parseInt(req.body.pageSize, 10) || defaultSize;
  return { pageId, pageSize, offset: (pageId - 1) * pageSize, limit: pageSize };
};

// conditions: array of [clause, ...values] — entries with empty/null/undefined values are skipped.
// Use the form ['col=?', value]; pass null/undefined/'' to omit the clause entirely.
const buildWhere = (conditions, prefix = '') => {
  const parts = [];
  const params = [];
  for (const cond of conditions) {
    if (!cond) continue;
    const [clause, ...vals] = cond;
    if (vals.length && vals.some((v) => v === undefined || v === null || v === '')) continue;
    parts.push(clause);
    params.push(...vals);
  }
  if (!parts.length) return { where: prefix ? ` WHERE ${prefix}` : '', params: [] };
  const head = prefix ? ` WHERE ${prefix} AND ` : ' WHERE ';
  return { where: head + parts.join(' AND '), params };
};

module.exports = { handler, fail, ok, paginate, buildWhere };
