const express = require('express'), {ok, h, bad, str, id, page, ApiError} = require('../http'), {requireAuth} = require('../middleware');
const {membership, completion} = require('../services/companies'), M = require('../services/matching'), {PUBLIC: CPUB} = require('../services/companies'), pay = require('../payments');
module.exports = (db, cfg) => {
  const r = express.Router();
  r.get('/health', h(async (q, s) => { let d = 'connected'; try { await db.query('SELECT 1'); } catch { d = 'unavailable'; } s.status(d === 'connected' ? 200 : 503).json({ok: d === 'connected', database: d}); }));
  const planOf = async (u, m) => (await db.query("SELECT * FROM plans WHERE id = COALESCE((SELECT plan_id FROM subscriptions WHERE status='active' AND ends_at>now() AND (user_id=$1 OR company_id=$2) ORDER BY ends_at DESC LIMIT 1),'free')", [u.id, m ? m.company_id : null])).rows[0];
  r.planOf = planOf;
  r.get('/plans', h(async (q, s) => ok(s, {data: (await db.query('SELECT id,name,price_paise,duration_days,tax_pct,features FROM plans WHERE active ORDER BY price_paise')).rows.map(p => ({id: p.id, name: p.name, price_inr: Number(p.price_paise) / 100, duration_days: p.duration_days, tax_pct: Number(p.tax_pct), features: p.features}))})));

  r.get('/dashboard', requireAuth, h(async (q, s) => {
    const u = q.user, m = await membership(db, u.id), cid = m ? m.company_id : null;
    const co = cid ? (await db.query('SELECT * FROM companies WHERE id=$1', [cid])).rows[0] : null, plan = await planOf(u, m);
    const rfqs = (await db.query('SELECT r.id,r.rfq_no,r.title,r.status,r.created_at,r.description,r.material,r.process,r.category,r.certification,(SELECT count(*) FROM quotes x WHERE x.rfq_id=r.id)::int AS responses FROM rfqs r WHERE r.created_by=$1 OR ($2::bigint IS NOT NULL AND r.company_id=$2) ORDER BY r.id DESC LIMIT 50', [u.id, cid])).rows;
    const cos = rfqs.length ? await M.approvedCompanies(db) : [];
    const out = {role: u.roles.includes('admin') ? 'admin' : u.roles[0], roles: u.roles, plan: plan.name, plan_id: plan.id, company_role: m ? m.role : null,
      company: co ? {id: String(co.id), name: co.name, status: co.status, verification: co.verification, completion: completion(co)} : null,
      rfqs: rfqs.map(x => ({id: String(x.id), rfq_no: x.rfq_no, title: x.title, status: x.status, created: x.created_at, responses: x.responses, matched: M.match(cos, x).length}))};
    out.saved = (await db.query('SELECT count(*)::int n FROM saved_suppliers WHERE user_id=$1', [u.id])).rows[0].n;
    out.unread = (await db.query('SELECT count(*)::int n FROM messages WHERE to_id=$1 AND read_at IS NULL', [u.id])).rows[0].n;
    out.notifications_unread = (await db.query('SELECT count(*)::int n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [u.id])).rows[0].n;
    if (co) { out.quotes_sent = (await db.query('SELECT count(*)::int n FROM quotes WHERE company_id=$1', [cid])).rows[0].n; out.enquiries = 0;
      out.rfq_opps = (await db.query("SELECT count(*)::int n FROM rfqs WHERE status = ANY($1) AND visibility='Public' AND created_by<>$2", [['Published','Matching','Responses Received'], u.id])).rows[0].n;
      if (plan.features.includes('analytics')) out.views = co.views; }
    ok(s, out);
  }));

  r.get('/profile', requireAuth, h(async (q, s) => ok(s, {id: String(q.user.id), name: q.user.name, email: q.user.email, phone: q.user.phone, roles: q.user.roles})));
  r.patch('/profile', requireAuth, h(async (q, s) => { const n = str(q.body.name, 'name', {min: 2, max: 100}) || q.user.name, p = q.body.phone === undefined ? q.user.phone : str(q.body.phone, 'phone', {max: 20}); await db.query('UPDATE users SET name=$2, phone=$3 WHERE id=$1', [q.user.id, n, p || null]); ok(s, {}); }));

  r.get('/notifications', requireAuth, h(async (q, s) => { const p = page(q.query); ok(s, {data: (await db.query('SELECT id,kind,text,link,read_at,created_at AS created FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3', [q.user.id, p.limit, p.offset])).rows, page: p.page, limit: p.limit}); }));
  r.post('/notifications/read-all', requireAuth, h(async (q, s) => { await db.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [q.user.id]); ok(s, {}); }));
  r.post('/notifications/:id/read', requireAuth, h(async (q, s) => { await db.query('UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2', [id(q.params.id), q.user.id]); ok(s, {}); }));

  const payRow = p => ({id: String(p.id), ref: p.provider_order_id, plan_id: p.plan_id, amount: Number(p.amount_paise) / 100, currency: p.currency, status: p.status, invoice_no: p.invoice_no, created: p.created_at});
  const payScope = async u => { const m = await membership(db, u.id); return {cid: m && ['owner', 'admin'].includes(m.role) ? m.company_id : null}; };   // company payments: owner/admin only
  r.get('/payments', requireAuth, h(async (q, s) => { const p = page(q.query), {cid} = await payScope(q.user);
    const data = (await db.query('SELECT * FROM payments WHERE user_id=$1 OR ($2::bigint IS NOT NULL AND company_id=$2) ORDER BY id DESC LIMIT $3 OFFSET $4', [q.user.id, cid, p.limit, p.offset])).rows.map(payRow);
    const subs = (await db.query('SELECT id,plan_id,status,starts_at,ends_at AS "end" FROM subscriptions WHERE user_id=$1 ORDER BY id DESC LIMIT 20', [q.user.id])).rows; ok(s, {data, subs, page: p.page, limit: p.limit}); }));
  r.get('/payments/:id', requireAuth, h(async (q, s) => { const {cid} = await payScope(q.user), p = (await db.query('SELECT * FROM payments WHERE id=$1 AND (user_id=$2 OR ($3::bigint IS NOT NULL AND company_id=$3))', [id(q.params.id), q.user.id, cid])).rows[0]; if (!p) throw new ApiError(404, 'NOT_FOUND', 'Payment not found.'); ok(s, payRow(p)); }));

  r.get('/subscription', requireAuth, h(async (q, s) => { const m = await membership(db, q.user.id), plan = await planOf(q.user, m);
    const sub = (await db.query("SELECT * FROM subscriptions WHERE status='active' AND ends_at>now() AND (user_id=$1 OR company_id=$2) ORDER BY ends_at DESC LIMIT 1", [q.user.id, m ? m.company_id : null])).rows[0] || null; ok(s, {plan: {id: plan.id, name: plan.name, features: plan.features}, subscription: sub}); }));
  r.post('/subscription/checkout', requireAuth, h(async (q, s) => {
    const plan = (await db.query('SELECT * FROM plans WHERE id=$1 AND active', [String(q.body.plan_id || '')])).rows[0]; if (!plan) throw bad('Plan not found');
    if (Number(plan.price_paise) === 0) throw bad('This plan needs no payment. Contact info@buye.online for Enterprise.');
    const amount = Math.round(Number(plan.price_paise) * (1 + Number(plan.tax_pct || 0) / 100)), m = await membership(db, q.user.id); let orderId;
    if (cfg.razorpay.keyId && cfg.razorpay.keySecret) {
      const rs = await fetch('https://api.razorpay.com/v1/orders', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(cfg.razorpay.keyId + ':' + cfg.razorpay.keySecret).toString('base64')}, body: JSON.stringify({amount, currency: 'INR', receipt: 'ia_' + Date.now()})});
      if (!rs.ok) throw new ApiError(502, 'GATEWAY_ERROR', 'Payment gateway error. Please try again.'); orderId = (await rs.json()).id;
    } else if (cfg.devVerify) orderId = 'order_dev_' + require('crypto').randomBytes(6).toString('hex');
    else throw new ApiError(503, 'NOT_CONFIGURED', 'Online payment is not enabled yet. Contact info@buye.online.');
    await db.query("INSERT INTO payments(user_id,company_id,plan_id,provider_order_id,amount_paise,status) VALUES($1,$2,$3,$4,$5,'Created')", [q.user.id, m ? m.company_id : null, plan.id, orderId, amount]);
    ok(s, {order_id: orderId, amount: amount / 100, currency: 'INR', key_id: cfg.razorpay.keyId || null, dev: !cfg.razorpay.keyId});
  }));
  r.post('/subscription/cancel', requireAuth, h(async (q, s) => { await db.query("UPDATE subscriptions SET status='cancelled' WHERE user_id=$1 AND status='active'", [q.user.id]); ok(s, {message: 'Subscription cancelled.'}); }));
  r.get('/saved', requireAuth, h(async (q, s) => ok(s, {data: (await db.query('SELECT ' + CPUB.map(k => 'c.' + k).join(',') + ", (SELECT user_id FROM company_members WHERE company_id=c.id AND role='owner' LIMIT 1) AS owner_id FROM saved_suppliers x JOIN companies c ON c.id=x.company_id WHERE x.user_id=$1 AND c.status='Approved'", [q.user.id])).rows})));
  r.post('/saved', requireAuth, h(async (q, s) => { await db.query('INSERT INTO saved_suppliers VALUES($1,$2) ON CONFLICT DO NOTHING', [q.user.id, id(q.body.company_id, 'company_id')]); ok(s, {}); }));

  // Development only: simulate the gateway's webhook for a local order. Not mounted in production.
  if (cfg.devVerify) r.post('/dev/simulate-payment', requireAuth, h(async (q, s) => {
    const p = (await db.query('SELECT * FROM payments WHERE provider_order_id=$1 AND user_id=$2', [String(q.body.order_id), q.user.id])).rows[0]; if (!p) throw new ApiError(404, 'NOT_FOUND', 'Order not found.');
    const out = await pay.handleRazorpayEvent(db, 'evt_dev_' + p.id, {event: 'payment.captured', payload: {payment: {entity: {id: 'pay_dev_' + p.id, order_id: p.provider_order_id, amount: Number(p.amount_paise), currency: p.currency}}}}); ok(s, {outcome: out});
  }));
  return r;
};
