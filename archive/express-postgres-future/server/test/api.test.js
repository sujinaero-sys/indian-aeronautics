const {describe, it, before, after} = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), crypto = require('crypto'), {execFileSync} = require('child_process');
process.env.NODE_ENV = 'test';
const cfg0 = require('../src/config'), db = require('../src/db'), {createApp} = require('../src/app');
const cfg = {...cfg0, razorpay: {webhookSecret: 'whsec_test'}, frontendOrigin: 'http://localhost:3000'};
let base, server, seq = 0;
function client() { let cookie = ''; const req = async (method, p, body, headers = {}) => { const r = await fetch(base + p, {method, headers: {'content-type': 'application/json', ...(cookie ? {cookie} : {}), ...headers}, body: body ? JSON.stringify(body) : undefined});
  for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) { const kv = c.split(';')[0]; cookie = kv.endsWith('=') ? '' : kv; } const j = await r.json().catch(() => null); return {status: r.status, body: j, data: j && j.data}; };
  return {get: p => req('GET', p), post: (p, b, h) => req('POST', p, b || {}, h), patch: (p, b) => req('PATCH', p, b || {}), put: (p, b) => req('PUT', p, b || {}), del: p => req('DELETE', p), raw: req, jar: () => cookie}; }
async function user(roles = ['buyer'], tag = 'u') { const c = client(), email = `${tag}${++seq}_${Date.now()}@test.example`;
  const r = await c.post('/api/auth/register', {name: 'Test ' + tag, email, password: 'Passw0rd!x', roles}); assert.equal(r.status, 201); const v = await c.post('/api/auth/verify', {email, code: r.data.dev_verification_code}); assert.equal(v.status, 200); c.email = email; c.id = v.data.user.id; return c; }
const hook = (body, secret = 'whsec_test', eid = 'evt_' + crypto.randomUUID()) => fetch(base + '/api/webhooks/razorpay', {method: 'POST', headers: {'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(body).digest('hex'), 'x-razorpay-event-id': eid}, body}).then(async r => ({status: r.status, body: await r.json(), eid}));
const captured = (order, amount) => JSON.stringify({event: 'payment.captured', payload: {payment: {entity: {id: 'pay_' + order, order_id: order, amount, currency: 'INR'}}}});

before(async () => {
  await db.query(fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8')); await db.query(fs.readFileSync(path.join(__dirname, '../seed.sql'), 'utf8'));
  await db.query('TRUNCATE users, companies, plans, webhook_events, audit_log, job_queue, merge_log RESTART IDENTITY CASCADE'); await db.query(fs.readFileSync(path.join(__dirname, '../seed.sql'), 'utf8'));
  server = createApp(db, cfg).listen(0); base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { server.close(); await db.end(); });

describe('infrastructure', () => {
  it('health reports database connected, no secrets', async () => { const r = await client().get('/api/health'); assert.equal(r.status, 200); assert.deepEqual(r.body, {ok: true, database: 'connected'}); });
  it('core tables, indexes, foreign keys exist', async () => {
    const t = (await db.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n; assert.ok(t >= 20);
    assert.ok((await db.query("SELECT count(*)::int n FROM pg_indexes WHERE schemaname='public'")).rows[0].n >= 10); assert.ok((await db.query("SELECT count(*)::int n FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY'")).rows[0].n >= 10); });
  it('transactions roll back', async () => { const c = await db.connect(); await c.query('BEGIN'); await c.query("INSERT INTO settings VALUES('tx_probe','1')"); await c.query('ROLLBACK'); c.release(); assert.equal((await db.query("SELECT 1 FROM settings WHERE key='tx_probe'")).rowCount, 0); });
  it('unknown API route returns the error envelope', async () => { const r = await client().get('/api/nope'); assert.equal(r.status, 404); assert.equal(r.body.success, false); assert.equal(r.body.error.code, 'NOT_FOUND'); });
  it('production config refuses to start without secrets and never enables dev verification', () => {
    const run = env => { try { return execFileSync('node', ['-e', "console.log(JSON.stringify(require('./src/config').devVerify))"], {cwd: path.join(__dirname, '..'), env: {PATH: process.env.PATH, ...env}, stdio: ['ignore', 'pipe', 'pipe']}).toString().trim(); } catch (e) { return 'THROWN'; } };
    assert.equal(run({NODE_ENV: 'production'}), 'THROWN'); assert.equal(run({NODE_ENV: 'production', DATABASE_URL: 'x', APP_SECRET: 'y', FRONTEND_ORIGIN: 'z', ENABLE_DEV_VERIFICATION: '1'}), 'false'); });
});

describe('authentication', () => {
  it('register → verify → login → me → logout → me', async () => {
    const c = client(), email = 'flow@test.example', r = await c.post('/api/auth/register', {name: 'Flow User', email, password: 'Passw0rd!x'}); assert.equal(r.status, 201); assert.ok(/^\d{6}$/.test(r.data.dev_verification_code));
    assert.equal((await c.post('/api/auth/login', {email, password: 'Passw0rd!x'})).body.error.code, 'EMAIL_NOT_VERIFIED');
    assert.equal((await c.post('/api/auth/verify', {email, code: '000000'})).status, 400);
    const v = await c.post('/api/auth/verify', {email, code: r.data.dev_verification_code}); assert.equal(v.status, 200); assert.equal(v.data.user.verified, true);
    assert.equal((await c.post('/api/auth/verify', {email, code: r.data.dev_verification_code})).status, 400, 'used code is invalid');
    const me = await c.get('/api/auth/me'); assert.equal(me.status, 200); assert.equal(me.data.email, email); assert.equal(me.data.password_hash, undefined); assert.equal(JSON.stringify(me.body).includes('hash'), false);
    assert.equal((await c.post('/api/auth/logout')).status, 200); const after = await c.get('/api/auth/me'); assert.equal(after.status, 401); assert.equal(after.body.error.code, 'AUTH_REQUIRED');
    const l = await c.post('/api/auth/login', {email, password: 'Passw0rd!x'}); assert.equal(l.status, 200); assert.equal((await c.get('/api/auth/me')).status, 200);
  });
  it('validates input and stores only hashed passwords', async () => {
    const c = client(); assert.equal((await c.post('/api/auth/register', {name: 'A', email: 'bad', password: 'x'})).status, 400);
    assert.equal((await c.post('/api/auth/register', {name: 'Weak Pw', email: 'weak@test.example', password: 'abcdefgh'})).status, 400);
    assert.equal((await c.post('/api/auth/register', {name: 'x'.repeat(500), email: 'long@test.example', password: 'Passw0rd!x'})).status, 400);
    await user(['buyer'], 'hash'); const row = (await db.query("SELECT password_hash FROM users WHERE email LIKE 'hash%' LIMIT 1")).rows[0]; assert.ok(row.password_hash.includes(':') && !row.password_hash.includes('Passw0rd'));
  });
  it('duplicate registration creates no second account and reveals nothing new', async () => {
    const c = await user(['buyer'], 'dup'), r = await client().post('/api/auth/register', {name: 'Dup Again', email: c.email, password: 'Another1pass'});
    assert.equal(r.status, 201); assert.equal(r.data.dev_verification_code, undefined); assert.equal((await db.query('SELECT count(*)::int n FROM users WHERE email=$1', [c.email])).rows[0].n, 1); });
  it('rejects wrong password, caps wrong verification codes, protects routes', async () => {
    const c = client(), email = 'attempts@test.example'; const r = await c.post('/api/auth/register', {name: 'Attempts', email, password: 'Passw0rd!x'});
    assert.equal((await c.post('/api/auth/login', {email, password: 'WrongPass1'})).status, 401); assert.equal((await c.post('/api/auth/login', {email: 'ghost@test.example', password: 'WrongPass1'})).status, 401);
    for (let i = 0; i < 5; i++) await c.post('/api/auth/verify', {email, code: '111111'}); assert.equal((await c.post('/api/auth/verify', {email, code: r.data.dev_verification_code})).status, 429);
    assert.equal((await client().get('/api/dashboard')).status, 401); });
  it('password reset works and invalidates sessions', async () => { const c = await user(['buyer'], 'rst'), f = await client().post('/api/auth/forgot', {email: c.email}); const n = client();
    assert.equal((await n.post('/api/auth/reset', {email: c.email, code: f.data.dev_reset_code, password: 'NewPassw0rd1'})).status, 200); assert.equal((await c.get('/api/auth/me')).status, 401); assert.equal((await n.post('/api/auth/login', {email: c.email, password: 'NewPassw0rd1'})).status, 200);
    assert.equal((await client().post('/api/auth/forgot', {email: 'nobody@test.example'})).status, 200); });
  it('blocks cross-site mutating requests', async () => { const c = await user(['buyer'], 'csrf'); const r = await c.raw('POST', '/api/auth/logout', {}, {origin: 'https://evil.example'}); assert.equal(r.status, 403); });
});

describe('companies, teams, authorization', () => {
  let owner, other, coId, hr, proc;
  before(async () => { owner = await user(['supplier'], 'own'); other = await user(['supplier'], 'oth');
    const r = await owner.put('/api/companies/mine', {name: 'ABC Aerospace Pvt Ltd', city: 'Chennai', capabilities: '5-axis CNC machining, aluminium, titanium', industry: 'Aerospace Manufacturing', email: 'info@abc.example', phone: '+91 9999999999'}); assert.equal(r.status, 201); coId = r.data.id; });
  it('private fields are not exposed publicly and pending companies are hidden', async () => { assert.equal((await client().get('/api/companies/' + coId)).status, 404); const m = await owner.get('/api/companies/' + coId); assert.equal(m.status, 200); assert.equal(m.data.email, 'info@abc.example');
    await db.query("UPDATE companies SET status='Approved' WHERE id=$1", [coId]); const p = await client().get('/api/companies/' + coId); assert.equal(p.status, 200); assert.equal(p.data.email, undefined); assert.equal(p.data.phone, undefined); });
  it('another user cannot modify or read members of the company by changing the ID', async () => { assert.equal((await other.patch('/api/companies/' + coId, {name: 'Hacked'})).status, 403); assert.equal((await other.get('/api/companies/' + coId + '/members')).status, 403); assert.equal((await owner.get('/api/companies/' + coId)).data.name, 'ABC Aerospace Pvt Ltd'); });
  it('team invitation and role-limited access', async () => {
    hr = await user(['employer'], 'hr'); proc = await user(['buyer'], 'proc');
    for (const [u, role] of [[hr, 'hr'], [proc, 'procurement']]) { const i = await owner.post(`/api/companies/${coId}/members`, {email: u.email, name: 'Member', role}); assert.equal(i.status, 201); assert.equal((await u.post('/api/invites/accept', {token: i.data.dev_invite_token})).status, 200); }
    assert.equal((await other.post(`/api/companies/${coId}/members`, {email: 'x@test.example', role: 'sales'})).status, 403);
    assert.equal((await hr.post('/api/rfqs', {title: 'HR cannot', quantity: '1'})).status, 403); assert.equal((await hr.patch('/api/companies/' + coId, {city: 'X'})).status, 403); assert.equal((await hr.post(`/api/companies/${coId}/members`, {email: 'y@test.example', role: 'viewer'})).status, 403);
    assert.equal((await proc.post('/api/rfqs', {title: 'Procurement can create', quantity: '10'})).status, 201); assert.equal((await proc.patch('/api/companies/' + coId, {city: 'X'})).status, 403);
    assert.equal((await hr.get(`/api/companies/${coId}/members`)).status, 200); });
  it('owner cannot be removed; members can be', async () => { const ms = (await owner.get(`/api/companies/${coId}/members`)).data.data, o = ms.find(m => m.role === 'owner'), h = ms.find(m => m.role === 'hr');
    assert.equal((await owner.del(`/api/companies/${coId}/members/${o.id}`)).status, 403); assert.equal((await owner.del(`/api/companies/${coId}/members/${h.id}`)).status, 200); });
  it('search is paginated, clamped and injection-safe', async () => { const r = await client().get('/api/companies?limit=100000&page=1&search=' + encodeURIComponent("'; DROP TABLE users; --")); assert.equal(r.status, 200); assert.equal(r.data.limit, 100); assert.ok(Array.isArray(r.data.data));
    const ok1 = await client().get('/api/companies?search=aerospace&state=&location=Chennai'); assert.equal(ok1.status, 200); assert.equal((await db.query('SELECT count(*)::int n FROM users')).rows[0].n > 0, true); assert.equal((await client().get('/api/rfqs/abc')).status, 401); });
});

describe('RFQs, quotations, payments, messages', () => {
  let buyer, sup, supCo, admin, rfqPublic, rfqPrivate, rfqVerified, order;
  before(async () => { buyer = await user(['buyer'], 'buy'); sup = await user(['supplier'], 'sup'); admin = await user(['buyer'], 'adm'); await db.query("UPDATE users SET roles='{admin}' WHERE id=$1", [admin.id]);
    supCo = (await sup.put('/api/companies/mine', {name: 'Precision Parts', city: 'Bengaluru', capabilities: '5-axis CNC machining, aluminium', industry: 'Aerospace Manufacturing'})).data.id; await db.query("UPDATE companies SET status='Approved' WHERE id=$1", [supCo]); });
  it('visibility rules decide what a supplier sees (feed and direct access)', async () => {
    const mk = (t, v) => buyer.post('/api/rfqs', {title: t, quantity: '100', unit: 'pcs', material: 'Aluminium', process: '5-axis CNC', visibility: v, certification: 'Required', delivery_date: ''});
    rfqPublic = (await mk('Public bracket 5-axis CNC', 'Public')).data; rfqPrivate = (await mk('Private bracket', 'Private')).data; rfqVerified = (await mk('Verified-only bracket', 'Verified suppliers')).data;
    assert.match(rfqPublic.rfq_no, /^RFQ-IA-\d{6}$/); assert.ok(rfqPublic.matched >= 1);
    let feed = (await sup.get('/api/rfqs/feed')).data.data.map(x => x.id); assert.ok(feed.includes(rfqPublic.id)); assert.ok(!feed.includes(rfqPrivate.id)); assert.ok(!feed.includes(rfqVerified.id));
    assert.equal((await sup.get('/api/rfqs/' + rfqPrivate.id)).status, 404); assert.equal((await sup.get('/api/rfqs/' + rfqVerified.id)).status, 404);
    await db.query("UPDATE companies SET verification='Profile Verified' WHERE id=$1", [supCo]); feed = (await sup.get('/api/rfqs/feed')).data.data.map(x => x.id); assert.ok(feed.includes(rfqVerified.id)); assert.equal((await sup.get('/api/rfqs/' + rfqVerified.id)).status, 200);
    assert.equal((await buyer.get('/api/rfqs')).data.data.length, 3); assert.equal((await sup.get('/api/rfqs')).data.data.length, 0, 'suppliers do not list buyers\' RFQs under "mine"');
  });
  it('supplier is notified and the buyer sees suppliers matched without invented data', async () => { const n = (await sup.get('/api/notifications')).data.data; assert.ok(n.some(x => /matching your capabilities/.test(x.text)));
    const m = await buyer.post(`/api/rfqs/${rfqPublic.id}/match`); assert.equal(m.data.ai, true); assert.ok(m.data.matches[0].why.length); assert.equal((await sup.post(`/api/rfqs/${rfqPublic.id}/match`)).status, 403); });
  it('quotation needs the plan feature; payment activates only via verified webhook', async () => {
    assert.equal((await sup.post(`/api/rfqs/${rfqPublic.id}/responses`, {price: 500, lead_time: '30 days'})).body.error.code, 'PLAN_REQUIRED');
    const plans = (await client().get('/api/plans')).data.data; assert.ok(plans.find(p => p.id === 'professional').price_inr === 4999);
    order = (await sup.post('/api/subscription/checkout', {plan_id: 'professional'})).data; assert.equal(order.amount, 5898.82);
    assert.equal((await hook(captured(order.order_id, 1), 'wrong_secret')).status, 400, 'bad signature');
    assert.equal((await hook(captured(order.order_id, 1))).body.data.outcome, 'amount mismatch'); assert.equal((await sup.get('/api/subscription')).data.plan.id, 'free');
    assert.equal((await sup.post(`/api/rfqs/${rfqPublic.id}/responses`, {price: 500, lead_time: '30 days'})).status, 403);
    const good = await hook(captured(order.order_id, 589882)); assert.equal(good.body.data.outcome, 'ok'); assert.equal((await sup.get('/api/subscription')).data.plan.id, 'professional');
    const dup = await fetch(base + '/api/webhooks/razorpay', {method: 'POST', headers: {'content-type': 'application/json', 'x-razorpay-signature': crypto.createHmac('sha256', 'whsec_test').update(captured(order.order_id, 589882)).digest('hex'), 'x-razorpay-event-id': good.eid}, body: captured(order.order_id, 589882)}).then(r => r.json()); assert.equal(dup.data.outcome, 'duplicate');
    assert.equal((await db.query('SELECT count(*)::int n FROM subscriptions WHERE payment_id IS NOT NULL')).rows[0].n, 1); const pays = (await sup.get('/api/payments')).data.data; assert.equal(pays[0].status, 'Paid'); assert.match(pays[0].invoice_no, /^INV-IA-/);
    assert.equal((await buyer.get('/api/payments/' + pays[0].id)).status, 404, 'other users cannot read my payment');
  });
  it('buyer reviews quotations; only the buyer can change their status', async () => {
    const r = await sup.post(`/api/rfqs/${rfqPublic.id}/responses`, {price: 500, currency: 'INR', lead_time: '30 days', moq: '50'}); assert.equal(r.status, 201); assert.equal((await sup.post(`/api/rfqs/${rfqPublic.id}/responses`, {price: -5, lead_time: 'x'})).status, 400);
    const view = (await buyer.get('/api/rfqs/' + rfqPublic.id)).data; assert.equal(view.owner, true); assert.equal(view.quotes.length, 1); assert.equal(view.rfq.status, 'Responses Received');
    assert.equal((await sup.patch(`/api/rfqs/${rfqPublic.id}/responses/${r.data.id}`, {status: 'Preferred'})).status, 403); assert.equal((await buyer.patch(`/api/responses/${r.data.id}`, {status: 'Shortlisted'})).status, 200);
    assert.equal((await buyer.patch(`/api/responses/${r.data.id}`, {status: 'Best'})).status, 400, 'no auto-"best"'); assert.equal((await sup.patch('/api/rfqs/' + rfqPublic.id, {status: 'Closed'})).status, 403); assert.equal((await buyer.patch('/api/rfqs/' + rfqPublic.id, {status: 'Closed'})).status, 200);
    assert.ok((await buyer.get('/api/notifications')).data.data.some(n => /quotation/i.test(n.text))); assert.equal((await buyer.post('/api/notifications/read-all')).status, 200);
    const dash = (await buyer.get('/api/dashboard')).data; assert.equal(dash.rfqs.length, 3); assert.equal(dash.rfqs.find(x => x.id === rfqPublic.id).responses, 1); });
  it('messaging: threads are private to their two participants', async () => {
    assert.equal((await buyer.post('/api/messages', {to_id: sup.id, body: 'Can you quote 500 units?'})).status, 201); const stranger = await user(['buyer'], 'str');
    const inbox = (await sup.get('/api/messages')).data; assert.equal(inbox.unread, 1); assert.equal(inbox.data[0].with, buyer.id);
    assert.equal((await stranger.get('/api/messages/' + buyer.id)).data.data.length, 0); assert.equal((await stranger.get('/api/messages')).data.data.length, 0);
    const th = await sup.get('/api/messages/' + buyer.id); assert.equal(th.data.data.length, 1); assert.equal((await sup.get('/api/messages')).data.unread, 0);
    assert.equal((await buyer.post('/api/messages', {to_id: buyer.id, body: 'me'})).status, 400); assert.equal((await buyer.post('/api/messages', {to_id: sup.id, body: ''})).status, 400); assert.equal((await client().get('/api/messages')).status, 401); });
  it('admin merge keeps populated data, fills empties, and can be undone; non-admins are refused', async () => {
    const a = (await db.query("INSERT INTO companies(name,email,website,city,status) VALUES('Merge ABC','info@abc2.example','abc2.example','Chennai','Approved') RETURNING id")).rows[0].id, d = (await db.query("INSERT INTO companies(name,phone,website,status) VALUES('Merge ABC Pvt Ltd','+91 9999999999','abc2.example','Approved') RETURNING id")).rows[0].id;
    assert.equal((await buyer.post('/api/admin/merge/preview', {existing_id: a, duplicate_id: d})).status, 403);
    const pv = (await admin.post('/api/admin/merge/preview', {existing_id: a, duplicate_id: d})).data; assert.deepEqual(pv.changes.map(c => c.field), ['phone']); assert.equal((await admin.post('/api/admin/merge/confirm', {existing_id: a, duplicate_id: d})).status, 409);
    const cf = await admin.post('/api/admin/merge/confirm', {existing_id: a, duplicate_id: d, choices: {name: 'existing'}}); assert.equal(cf.status, 200); const row = (await db.query('SELECT * FROM companies WHERE id=$1', [a])).rows[0];
    assert.equal(row.name, 'Merge ABC'); assert.equal(row.email, 'info@abc2.example'); assert.equal(row.phone, '+91 9999999999'); assert.equal(row.city, 'Chennai'); assert.equal((await db.query('SELECT status FROM companies WHERE id=$1', [d])).rows[0].status, 'Merged');
    assert.equal((await admin.post('/api/admin/merge/undo', {merge_id: cf.data.merge_id})).status, 200); assert.equal((await db.query('SELECT phone FROM companies WHERE id=$1', [a])).rows[0].phone, null); assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action='company_merge'")).rowCount === 1); });
  it('logout makes protected routes inaccessible', async () => { await buyer.post('/api/auth/logout'); for (const p of ['/api/dashboard', '/api/rfqs', '/api/messages', '/api/payments', '/api/notifications', '/api/subscription']) assert.equal((await buyer.get(p)).status, 401, p); });
});
