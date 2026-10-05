const express = require('express'), cookieParser = require('cookie-parser'), {attachUser, requireAuth} = require('./middleware'), {errorHandler, ok, h, ApiError} = require('./http'), pay = require('./payments'), A = require('./auth'), C = require('./services/companies');
function createApp(db, cfg) {
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', 1);
  app.use((q, s, n) => { s.set({'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin'}); n(); });
  const hook = express.raw({type: '*/*'}), webhook = h(async (q, s) => {   // raw body is required to verify the signature; registered before express.json()
    if (!pay.verifySignature(q.body, q.get('x-razorpay-signature'), cfg.razorpay.webhookSecret)) throw new ApiError(400, 'BAD_SIGNATURE', 'Invalid signature.');
    let ev; try { ev = JSON.parse(q.body.toString()); } catch { throw new ApiError(400, 'BAD_JSON', 'Invalid payload.'); } const eid = q.get('x-razorpay-event-id'); if (!eid) throw new ApiError(400, 'BAD_EVENT', 'Missing event id.');
    ok(s, {outcome: await pay.handleRazorpayEvent(db, eid, ev)}); });
  app.post('/api/webhooks/razorpay', hook, webhook); app.post('/webhooks/razorpay', hook, webhook);
  app.use(express.json({limit: '1mb'}), cookieParser());
  app.use('/api', (q, s, n) => { const o = q.get('origin'); // CORS allow-list + CSRF defence for cookie auth
    if (o && o === cfg.frontendOrigin) { s.set({'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE', Vary: 'Origin'}); if (q.method === 'OPTIONS') return s.sendStatus(204); }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method)) { if (o && o !== cfg.frontendOrigin && new URL(o).host !== q.get('host')) return n(new ApiError(403, 'BAD_ORIGIN', 'Origin not allowed.')); if (!q.is('application/json') && Number(q.get('content-length') || 0) > 0) return n(new ApiError(415, 'BAD_CONTENT_TYPE', 'Use application/json.')); }
    n(); });
  app.use('/api', attachUser(db));
  const core = require('./routes/core')(db, cfg);
  app.use('/api', core); app.use('/api/auth', require('./routes/auth')(db, cfg)); app.use('/api/companies', require('./routes/companies')(db, cfg));
  const rfqs = require('./routes/rfqs')(db, cfg, core.planOf); app.use('/api/rfqs', rfqs); app.use('/api/messages', require('./routes/messages')(db)); app.use('/api/admin', require('./routes/admin')(db));
  app.patch('/api/responses/:id', requireAuth, h((q, s) => rfqs.setQuote(q, s, q.params.id)));   // quotation status by id (portal compatibility)
  app.post('/api/invites/accept', requireAuth, h(async (q, s) => { const i = (await db.query('SELECT * FROM company_invites WHERE token_hash=$1 AND NOT accepted AND expires_at>now()', [A.hmac(String(q.body.token || ''))])).rows[0];
    if (!i || i.email !== q.user.email) throw new ApiError(400, 'INVALID_INVITE', 'Invitation invalid, expired or for another email.');
    if (await C.membership(db, q.user.id)) throw new ApiError(409, 'ALREADY_MEMBER', 'You already belong to a company.');
    await db.query('INSERT INTO company_members VALUES($1,$2,$3)', [i.company_id, q.user.id, i.role]); await db.query('UPDATE company_invites SET accepted=true WHERE id=$1', [i.id]); ok(s, {}); }));
  app.use('/api', (q, s, n) => n(new ApiError(404, 'NOT_FOUND', 'Unknown API route.')));
  if (cfg.staticDir) app.use(express.static(cfg.staticDir));   // development convenience: same-origin frontend + API
  app.use(errorHandler); return app;
}
module.exports = {createApp};
