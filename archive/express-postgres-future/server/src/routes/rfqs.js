const express = require('express'), {ok, h, bad, str, id, page, oneOf, ApiError} = require('../http'), {requireAuth} = require('../middleware'), {can} = require('../permissions');
const C = require('../services/companies'), M = require('../services/matching'), {notify} = require('../services/notify');
const LIVE = ['Published','Matching','Responses Received','Shortlisted','Negotiation'], STATUS = ['Draft','Published','Matching','Responses Received','Shortlisted','Negotiation','Closed','Cancelled'];
const VIS = ['Public','Registered suppliers','Verified suppliers','Invite-only','Private'], QSTAT = ['Shortlisted','Rejected','Preferred','Clarification Requested'];
module.exports = (db, cfg, planOf) => {
  const r = express.Router(); r.use(requireAuth);
  async function ctx(u) {
    const m = await C.membership(db, u.id); let verified = false;
    if (m) { const c = (await db.query('SELECT verification,status FROM companies WHERE id=$1', [m.company_id])).rows[0]; verified = !!c && c.status === 'Approved' && c.verification !== 'Basic Profile'; }
    return {m, verified, isSup: !!m || u.roles.some(x => ['supplier', 'mro', 'company_rep', 'company_admin'].includes(x)), admin: u.roles.includes('admin')};
  }
  // SQL predicate: which RFQs may this user see as a supplier (visibility rules + verification + membership)
  const visSql = (x, args) => { args.push(x.isSup, x.verified, x.m ? x.m.company_id : null); const n = args.length;
    return `(r.status = ANY('{${LIVE.map(s => '"' + s + '"').join(',')}}') AND (r.visibility='Public' OR (r.visibility='Registered suppliers' AND $${n - 2}::bool) OR (r.visibility='Verified suppliers' AND $${n - 1}::bool) OR (r.visibility='Invite-only' AND $${n}::bigint = ANY(r.invited))))`; };
  const isOwner = (x, u, rfq) => x.admin || String(rfq.created_by) === String(u.id) || (x.m && rfq.company_id && String(rfq.company_id) === String(x.m.company_id) && can(x.m.role, 'rfq.responses'));
  const load = async (rid, u) => { const x = await ctx(u), args = [id(rid)], rfq = (await db.query(`SELECT r.* FROM rfqs r WHERE r.id=$1 AND (${visSql(x, args)} OR r.created_by=$${args.length + 1}${x.admin ? ' OR true' : ''} OR ($${args.length + 2}::bigint IS NOT NULL AND r.company_id=$${args.length + 2}))`, [...args, u.id, x.m ? x.m.company_id : null])).rows[0];
    if (!rfq) throw new ApiError(404, 'NOT_FOUND', 'RFQ not available.'); return {x, rfq, owner: isOwner(x, u, rfq)}; };
  const out = rr => ({id: String(rr.id), rfq_no: rr.rfq_no, title: rr.title, description: rr.description, category: rr.category, quantity: rr.quantity, unit: rr.unit, material: rr.material, process: rr.process, certification: rr.certification, location: rr.location, delivery_date: rr.delivery_date, budget: rr.budget, status: rr.status, visibility: rr.visibility, owner_id: String(rr.created_by), created: rr.created_at});
  const nullify = v => v === '' || v == null ? null : v;

  r.get('/', h(async (q, s) => { const x = await ctx(q.user), p = page(q.query);
    const rows = (await db.query('SELECT r.*, (SELECT count(*) FROM quotes z WHERE z.rfq_id=r.id)::int AS responses FROM rfqs r WHERE r.created_by=$1 OR ($2::bigint IS NOT NULL AND r.company_id=$2) ORDER BY r.id DESC LIMIT $3 OFFSET $4', [q.user.id, x.m ? x.m.company_id : null, p.limit, p.offset])).rows; ok(s, {data: rows.map(a => ({...out(a), responses: a.responses})), page: p.page, limit: p.limit}); }));
  r.get('/feed', h(async (q, s) => { const x = await ctx(q.user), p = page(q.query), args = [], v = visSql(x, args);
    const rows = (await db.query(`SELECT r.* FROM rfqs r WHERE ${v} AND r.created_by<>$${args.length + 1} ORDER BY r.id DESC LIMIT $${args.length + 2} OFFSET $${args.length + 3}`, [...args, q.user.id, p.limit, p.offset])).rows; ok(s, {data: rows.map(out), page: p.page, limit: p.limit}); }));
  r.post('/', h(async (q, s) => { const x = await ctx(q.user), b = q.body;
    if (x.m && !can(x.m.role, 'rfq.create') && !x.admin) throw new ApiError(403, 'FORBIDDEN', 'Your company role cannot create RFQs.');
    const f = {title: str(b.title, 'title', {min: 3, max: 200, required: true}), description: str(b.description, 'description', {max: 4000}), category: str(b.category, 'category', {max: 100}), quantity: str(b.quantity, 'quantity', {max: 50, required: true}), unit: str(b.unit, 'unit', {max: 30}), material: str(b.material, 'material', {max: 100}), process: str(b.process, 'process', {max: 100}), certification: str(b.certification, 'certification', {max: 100}), location: str(b.location, 'location', {max: 100}), budget: str(b.budget, 'budget', {max: 50}), delivery_date: nullify(str(b.delivery_date, 'delivery_date', {max: 10}))};
    if (f.delivery_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.delivery_date)) throw bad('delivery_date must be YYYY-MM-DD');
    const vis = b.visibility ? oneOf(b.visibility, VIS, 'visibility') : 'Verified suppliers', status = b.publish === false ? 'Draft' : 'Published';
    const n = (await db.query("SELECT nextval('rfq_no_seq') n")).rows[0].n, no = 'RFQ-IA-' + String(n).padStart(6, '0');
    const ks = Object.keys(f), row = (await db.query(`INSERT INTO rfqs(rfq_no,company_id,created_by,visibility,status,${ks.join(',')}) VALUES($1,$2,$3,$4,$5,${ks.map((k, i) => '$' + (i + 6)).join(',')}) RETURNING *`, [no, x.m ? x.m.company_id : null, q.user.id, vis, status, ...ks.map(k => f[k])])).rows[0];
    let matched = 0; if (status === 'Published' && vis !== 'Private') { const ms = M.match(await M.approvedCompanies(db), row); matched = ms.length; for (const m of ms) await notify(db, m.company.owner_id, 'New RFQ matching your capabilities: ' + row.title, 'rfq', '#/rfq/' + row.id); }
    ok(s, {id: String(row.id), rfq_no: no, matched}, 201); }));
  r.get('/:id', h(async (q, s) => { const {rfq, owner} = await load(q.params.id, q.user);
    const quotes = (await db.query('SELECT z.*, c.name AS company_name, (SELECT user_id FROM company_members WHERE company_id=c.id AND role=\'owner\' LIMIT 1) AS user_id FROM quotes z JOIN companies c ON c.id=z.company_id WHERE z.rfq_id=$1 ORDER BY z.id', [rfq.id])).rows;
    const mine = owner ? quotes : quotes.filter(z => String(z.created_by) === String(q.user.id));
    ok(s, {rfq: out(rfq), owner, quotes: mine.map(z => ({id: String(z.id), company_name: z.company_name, user_id: z.user_id ? String(z.user_id) : null, price: z.price, currency: z.currency, moq: z.moq, lead_time: z.lead_time, terms: z.terms, validity: z.validity, comments: z.comments, status: z.status}))}); }));
  r.patch('/:id', h(async (q, s) => { const {rfq, owner} = await load(q.params.id, q.user); if (!owner) throw new ApiError(403, 'FORBIDDEN', 'Only the buyer can change this RFQ.');
    const sets = [], vals = [rfq.id]; if (q.body.status !== undefined) { sets.push('status=$' + vals.push(oneOf(q.body.status, STATUS, 'status'))); }
    if (q.body.visibility !== undefined) sets.push('visibility=$' + vals.push(oneOf(q.body.visibility, VIS, 'visibility')));
    for (const k of ['title', 'description', 'category', 'quantity', 'unit', 'material', 'process', 'certification', 'location', 'budget']) if (q.body[k] !== undefined) sets.push(k + '=$' + vals.push(str(q.body[k], k, {max: k === 'description' ? 4000 : 200})));
    if (!sets.length) throw bad('Nothing to update'); await db.query(`UPDATE rfqs SET ${sets.join(',')} WHERE id=$1`, vals);
    if (q.body.status === 'Published' && rfq.status !== 'Published') for (const m of M.match(await M.approvedCompanies(db), rfq)) await notify(db, m.company.owner_id, 'New RFQ matching your capabilities: ' + rfq.title, 'rfq', '#/rfq/' + rfq.id);
    ok(s, {}); }));
  r.post('/:id/match', h(async (q, s) => { const {rfq, owner} = await load(q.params.id, q.user); if (!owner) throw new ApiError(403, 'FORBIDDEN', 'Only the buyer can run matching.');
    ok(s, {ai: true, extracted: M.extract([rfq.title, rfq.description, rfq.material, rfq.process].join(' ')), matches: M.match(await M.approvedCompanies(db), rfq)}); }));
  r.post('/:id/responses', h(async (q, s) => { const {x, rfq, owner} = await load(q.params.id, q.user); if (owner) throw bad('You cannot respond to your own RFQ');
    if (!x.m || !can(x.m.role, 'rfq.respond')) throw new ApiError(403, 'FORBIDDEN', 'You need a company account with permission to respond to RFQs.');
    if (String(rfq.company_id) === String(x.m.company_id)) throw bad('Your company cannot respond to its own RFQ');
    if (!(await planOf(q.user, x.m)).features.includes('rfq_access')) throw new ApiError(403, 'PLAN_REQUIRED', 'Your plan does not include RFQ responses. Upgrade to Professional.');
    const b = q.body, price = Number(b.price); if (!(price > 0) || !isFinite(price)) throw bad('price must be a positive number');
    const z = (await db.query('INSERT INTO quotes(rfq_id,company_id,created_by,price,currency,moq,lead_time,terms,validity,comments) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id', [rfq.id, x.m.company_id, q.user.id, price, oneOf(b.currency || 'INR', ['INR', 'USD', 'EUR'], 'currency'), str(b.moq, 'moq', {max: 50}), str(b.lead_time, 'lead_time', {max: 100, required: true}), str(b.terms, 'terms', {max: 500}), str(b.validity, 'validity', {max: 100}), str(b.comments, 'comments', {max: 2000})])).rows[0];
    if (['Published', 'Matching'].includes(rfq.status)) await db.query("UPDATE rfqs SET status='Responses Received' WHERE id=$1", [rfq.id]); await notify(db, rfq.created_by, 'New quotation on ' + rfq.rfq_no, 'quote', '#/rfq/' + rfq.id);
    ok(s, {id: String(z.id)}, 201); }));
  r.get('/:id/responses', h(async (q, s) => { const {rfq, owner} = await load(q.params.id, q.user);
    const rows = (await db.query('SELECT z.*, c.name AS company_name FROM quotes z JOIN companies c ON c.id=z.company_id WHERE z.rfq_id=$1' + (owner ? '' : ' AND z.created_by=$2') + ' ORDER BY z.id', owner ? [rfq.id] : [rfq.id, q.user.id])).rows; ok(s, {data: rows}); }));
  const setQuote = async (q, s, qid) => { const z = (await db.query('SELECT z.*, r.created_by, r.company_id AS rc, r.rfq_no FROM quotes z JOIN rfqs r ON r.id=z.rfq_id WHERE z.id=$1', [id(qid)])).rows[0]; if (!z) throw new ApiError(404, 'NOT_FOUND', 'Quotation not found.');
    const x = await ctx(q.user); if (!isOwner(x, q.user, {created_by: z.created_by, company_id: z.rc})) throw new ApiError(403, 'FORBIDDEN', 'Only the buyer can change this quotation.');
    const st = oneOf(q.body.status, QSTAT, 'status'); await db.query('UPDATE quotes SET status=$2 WHERE id=$1', [z.id, st]); await notify(db, z.created_by, z.rfq_no + ': your quotation is now "' + st + '"', 'quote'); ok(s, {}); };
  r.patch('/:id/responses/:rid', h((q, s) => setQuote(q, s, q.params.rid)));
  r.setQuote = setQuote; return r;
};
