const express = require('express'), {ok, h, id, ApiError} = require('../http'), {requireAdmin} = require('../middleware'), M = require('../merge');
module.exports = (db) => {
  const r = express.Router(); r.use(requireAdmin);
  const audit = (u, action, d) => db.query('INSERT INTO audit_log(user_id,action,detail) VALUES($1,$2,$3)', [u.id, action, JSON.stringify(d)]);
  const co = async x => { const c = (await db.query('SELECT * FROM companies WHERE id=$1 AND merged_into IS NULL', [id(x)])).rows[0]; if (!c) throw new ApiError(404, 'NOT_FOUND', 'Company not found.'); return c; };
  r.post('/merge/preview', h(async (q, s) => ok(s, M.previewMerge(await co(q.body.existing_id), await co(q.body.duplicate_id), q.body.choices || {}))));
  r.post('/merge/confirm', h(async (q, s) => {
    const ex = await co(q.body.existing_id), du = await co(q.body.duplicate_id); if (ex.id === du.id) throw new ApiError(400, 'VALIDATION_ERROR', 'Pick two different companies.');
    const pv = M.previewMerge(ex, du, q.body.choices || {}); if (pv.needsDecision) throw new ApiError(409, 'CONFLICTS_UNRESOLVED', 'Resolve every conflict first.');
    const c = await db.connect(); try { await c.query('BEGIN'); const prev = {};
      for (const x of pv.changes) { if (!M.FIELDS.includes(x.field)) continue; prev[x.field] = x.from; await c.query(`UPDATE companies SET ${x.field}=$2 WHERE id=$1`, [ex.id, x.to]); }
      await c.query("UPDATE companies SET merged_into=$2, status='Merged' WHERE id=$1", [du.id, ex.id]);
      await c.query('UPDATE company_members SET company_id=$1 WHERE company_id=$2 AND user_id NOT IN (SELECT user_id FROM company_members WHERE company_id=$1)', [ex.id, du.id]);
      for (const t of ['rfqs', 'quotes']) await c.query(`UPDATE ${t} SET company_id=$1 WHERE company_id=$2`, [ex.id, du.id]);
      const log = (await c.query('INSERT INTO merge_log(admin_id,existing_id,duplicate_id,changes,previous) VALUES($1,$2,$3,$4,$5) RETURNING id', [q.user.id, ex.id, du.id, JSON.stringify(pv.changes), JSON.stringify(prev)])).rows[0];
      await c.query('COMMIT'); await audit(q.user, 'company_merge', {log: log.id}); ok(s, {merge_id: String(log.id), changes: pv.changes});
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }));
  r.post('/merge/undo', h(async (q, s) => { const m = (await db.query('SELECT * FROM merge_log WHERE id=$1 AND NOT undone', [id(q.body.merge_id)])).rows[0]; if (!m) throw new ApiError(404, 'NOT_FOUND', 'Nothing to undo.');
    for (const [f, v] of Object.entries(m.previous)) if (M.FIELDS.includes(f)) await db.query(`UPDATE companies SET ${f}=$2 WHERE id=$1`, [m.existing_id, v]);
    await db.query("UPDATE companies SET merged_into=NULL, status='Pending' WHERE id=$1", [m.duplicate_id]); await db.query('UPDATE merge_log SET undone=true WHERE id=$1', [m.id]); await audit(q.user, 'merge_undo', {id: m.id}); ok(s, {note: 'Field values restored. RFQs, quotes and members stay with the surviving company.'}); }));
  r.get('/audit', h(async (q, s) => ok(s, {data: (await db.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100')).rows})));
  return r;
};
