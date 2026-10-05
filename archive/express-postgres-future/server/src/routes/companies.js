const express = require('express'), A = require('../auth'), mail = require('../mail'), {ok, h, bad, str, id, page, oneOf, ApiError} = require('../http'), {requireAuth} = require('../middleware'), C = require('../services/companies');
const MEMBER_ROLES = ['admin','procurement','sales','hr','engineering','viewer'];
module.exports = (db, cfg) => {
  const r = express.Router();
  const clean = body => { const o = {}; C.FIELDS.forEach(k => { if (body[k] !== undefined) o[k] = str(body[k], k, {max: k === 'description' ? 2000 : 300}); }); return o; };
  r.get('/', h(async (q, s) => { // public search, paginated, parameterized
    const p = page(q.query), args = [], w = ["c.status='Approved'", 'c.merged_into IS NULL'], add = (sql, v) => { args.push(v); w.push(sql.replace('?', '$' + args.length)); };
    if (q.query.search) add("to_tsvector('simple', coalesce(c.name,'')||' '||coalesce(c.capabilities,'')||' '||coalesce(c.products,'')||' '||coalesce(c.city,'')||' '||coalesce(c.state,'')) @@ plainto_tsquery('simple', ?)", String(q.query.search).slice(0, 100));
    for (const f of ['industry', 'state', 'city', 'type', 'category']) if (q.query[f]) add(`lower(c.${f}) = lower(?)`, String(q.query[f]).slice(0, 100));
    if (q.query.location) { args.push(String(q.query.location).slice(0, 100)); const n = args.length; w.push(`(lower(c.city)=lower($${n}) OR lower(c.state)=lower($${n}))`); }
    const where = w.join(' AND '), total = (await db.query('SELECT count(*)::int n FROM companies c WHERE ' + where, args)).rows[0].n;
    const rows = (await db.query(`SELECT ${C.PUBLIC.map(k => 'c.' + k).join(',')}, (SELECT user_id FROM company_members WHERE company_id=c.id AND role='owner' LIMIT 1) AS owner_id FROM companies c WHERE ${where} ORDER BY c.name LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, p.limit, p.offset])).rows;
    ok(s, {data: rows, page: p.page, limit: p.limit, total});
  }));
  r.get('/mine', requireAuth, h(async (q, s) => { const m = await C.membership(db, q.user.id); ok(s, {company: m ? (await db.query('SELECT * FROM companies WHERE id=$1', [m.company_id])).rows[0] : null, company_role: m ? m.role : null}); }));
  r.put('/mine', requireAuth, h(async (q, s) => { // create-or-update own company (used by the portal "My company" form)
    if (!q.user.roles.some(x => ['supplier', 'mro', 'company_rep', 'company_admin', 'trainer', 'employer', 'admin'].includes(x))) throw new ApiError(403, 'FORBIDDEN', 'Your account type cannot own a company.');
    const m = await C.membership(db, q.user.id), f = clean(q.body);
    if (m) { await C.authorize(db, q.user, m.company_id, 'company.manage'); const ks = Object.keys(f); if (ks.length) await db.query(`UPDATE companies SET ${ks.map((k, i) => k + '=$' + (i + 2)).join(',')} WHERE id=$1`, [m.company_id, ...ks.map(k => f[k])]); return ok(s, {id: String(m.company_id)}); }
    str(f.name, 'name', {min: 2, required: true}); const ks = Object.keys(f), c = (await db.query(`INSERT INTO companies(${ks.join(',')}) VALUES(${ks.map((k, i) => '$' + (i + 1)).join(',')}) RETURNING id`, ks.map(k => f[k]))).rows[0];
    await db.query("INSERT INTO company_members VALUES($1,$2,'owner')", [c.id, q.user.id]); ok(s, {id: String(c.id)}, 201);
  }));
  r.get('/:id', h(async (q, s) => { const cid = id(q.params.id), c = (await db.query('SELECT * FROM companies WHERE id=$1 AND merged_into IS NULL', [cid])).rows[0]; if (!c) throw new ApiError(404, 'NOT_FOUND', 'Company not found.');
    let member = null; if (q.user) { member = q.user.roles.includes('admin') ? 'admin' : ((await db.query('SELECT role FROM company_members WHERE company_id=$1 AND user_id=$2', [cid, q.user.id])).rows[0] || {}).role; }
    if (c.status !== 'Approved' && !member) throw new ApiError(404, 'NOT_FOUND', 'Company not found.');
    ok(s, member ? {...c, viewer_role: member} : C.pickPublic(c)); }));   // private fields (email, phone, address, contact) only for members/admin
  r.patch('/:id', requireAuth, h(async (q, s) => { const cid = id(q.params.id); await C.authorize(db, q.user, cid, 'company.manage'); const f = clean(q.body), ks = Object.keys(f); if (!ks.length) throw bad('Nothing to update');
    await db.query(`UPDATE companies SET ${ks.map((k, i) => k + '=$' + (i + 2)).join(',')} WHERE id=$1`, [cid, ...ks.map(k => f[k])]); ok(s, {}); }));
  r.get('/:id/members', requireAuth, h(async (q, s) => { const cid = id(q.params.id); await C.authorize(db, q.user, cid, 'company.view');
    ok(s, {data: (await db.query('SELECT u.id, u.name, u.email, cm.role FROM company_members cm JOIN users u ON u.id=cm.user_id WHERE cm.company_id=$1 ORDER BY cm.role, u.name', [cid])).rows}); }));
  r.post('/:id/members', requireAuth, h(async (q, s) => { // invitation (consent required); the invitee accepts at /api/invites/accept
    const cid = id(q.params.id); await C.authorize(db, q.user, cid, 'team.manage'); const em = require('../http').email(q.body.email), role = oneOf(q.body.role, MEMBER_ROLES, 'role'), t = A.newToken();
    await db.query("INSERT INTO company_invites(company_id,email,name,role,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days')", [cid, em, str(q.body.name, 'name', {max: 100}), role, A.hmac(t)]);
    if (cfg.emailEnabled) { const co = (await db.query('SELECT name FROM companies WHERE id=$1', [cid])).rows[0]; mail.send(db, em, 'company_invitation', {name: q.body.name || '', company: co.name, link: cfg.frontendOrigin + '/portal.html#/accept/' + t}).catch(() => {}); }
    ok(s, {message: 'Invitation created.', ...(cfg.devVerify ? {dev_invite_token: t} : {})}, 201); }));
  r.delete('/:id/members/:memberId', requireAuth, h(async (q, s) => { const cid = id(q.params.id), mid = id(q.params.memberId, 'memberId'); await C.authorize(db, q.user, cid, 'team.manage');
    const t = (await db.query('SELECT role FROM company_members WHERE company_id=$1 AND user_id=$2', [cid, mid])).rows[0]; if (!t) throw new ApiError(404, 'NOT_FOUND', 'Member not found.'); if (t.role === 'owner') throw new ApiError(403, 'FORBIDDEN', 'The owner cannot be removed.');
    await db.query('DELETE FROM company_members WHERE company_id=$1 AND user_id=$2', [cid, mid]); ok(s, {}); }));
  return r;
};
