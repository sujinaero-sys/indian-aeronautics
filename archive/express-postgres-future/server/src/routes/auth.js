const express = require('express'), rateLimit = require('express-rate-limit'), A = require('../auth'), mail = require('../mail');
const {ok, h, bad, str, email, password, ApiError} = require('../http'), {requireAuth} = require('../middleware'), {membership} = require('../services/companies');
const ACCOUNT_TYPES = ['buyer','supplier','professional','trainer','student','mro','employer','company_admin','company_rep'];
module.exports = (db, cfg) => {
  const r = express.Router(), lim = rateLimit({windowMs: 15 * 60e3, max: cfg.authLimit, standardHeaders: true, legacyHeaders: false, handler: (q, s) => s.status(429).json({success: false, error: {code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.'}})});
  const setCookie = async (res, uid) => res.cookie('ia_sid', await A.createSession(db, uid), {httpOnly: true, secure: cfg.isProd, sameSite: cfg.isProd ? 'none' : 'lax', maxAge: 7 * 864e5, path: '/'});
  const primary = u => u.roles.includes('admin') ? 'admin' : u.roles[0] || 'buyer';
  const pub = async u => { const m = await membership(db, u.id); return {id: String(u.id), name: u.name, email: u.email, role: primary(u), roles: u.roles, verified: u.email_verified, company_id: m ? String(m.company_id) : null, company_role: m ? m.role : null}; };
  async function issueCode(u, purpose) {
    const code = A.newCode(); await db.query('UPDATE email_codes SET used=true WHERE user_id=$1 AND purpose=$2 AND NOT used', [u.id, purpose]);
    await db.query("INSERT INTO email_codes(user_id,purpose,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '15 minutes')", [u.id, purpose, A.hmac(code + u.id)]);
    if (cfg.devVerify) console.log(`[DEV ONLY] ${purpose} code for ${u.email}: ${code}`);
    if (cfg.emailEnabled) { try { await mail.send(db, u.email, purpose === 'verify' ? 'email_verification' : 'password_reset', {name: u.name, code}); } catch (e) { console.error('email failed'); } }
    return code;
  }
  async function useCode(u, purpose, code) {
    const invalid = new ApiError(400, 'INVALID_CODE', 'Invalid or expired code.');
    const c = (await db.query('SELECT * FROM email_codes WHERE user_id=$1 AND purpose=$2 AND NOT used AND expires_at>now() ORDER BY id DESC LIMIT 1', [u.id, purpose])).rows[0];
    if (!c) throw invalid; if (c.attempts >= 5) throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong codes. Request a new code.');
    await db.query('UPDATE email_codes SET attempts=attempts+1 WHERE id=$1', [c.id]);
    if (c.code_hash !== A.hmac(String(code).trim() + u.id)) throw invalid;
    await db.query('UPDATE email_codes SET used=true WHERE id=$1', [c.id]);
  }
  const byEmail = async e => (await db.query('SELECT * FROM users WHERE email=$1', [e])).rows[0];
  const generic = {message: 'If this email can be registered, a verification code has been sent.'};

  r.post('/register', lim, h(async (q, s) => {
    const name = str(q.body.name, 'name', {min: 2, max: 100, required: true}), em = email(q.body.email), pw = password(q.body.password);
    const roles = [...new Set((Array.isArray(q.body.roles) ? q.body.roles : [q.body.role || 'buyer']).filter(x => ACCOUNT_TYPES.includes(x)))]; if (!roles.length) roles.push('buyer');
    const phone = str(q.body.phone, 'phone', {max: 20}) || null; let u = await byEmail(em), dev;
    if (!u) { u = (await db.query('INSERT INTO users(email,name,phone,password_hash,roles) VALUES($1,$2,$3,$4,$5) RETURNING *', [em, name, phone, A.hashPassword(pw), roles])).rows[0]; dev = await issueCode(u, 'verify'); }
    else if (!u.email_verified && u.password_hash) dev = await issueCode(u, 'verify');   // same response either way: no account enumeration
    ok(s, {...generic, ...(cfg.devVerify && dev ? {dev_verification_code: dev} : {})}, 201);
  }));
  r.post('/verify', lim, h(async (q, s) => {
    const u = await byEmail(email(q.body.email)); if (!u) throw new ApiError(400, 'INVALID_CODE', 'Invalid or expired code.');
    await useCode(u, 'verify', q.body.code); await db.query('UPDATE users SET email_verified=true WHERE id=$1', [u.id]); u.email_verified = true;
    await setCookie(s, u.id); ok(s, {user: await pub(u)});
  }));
  r.post('/resend', lim, h(async (q, s) => { const u = await byEmail(email(q.body.email)); let dev; if (u && !u.email_verified) dev = await issueCode(u, 'verify'); ok(s, {...generic, ...(cfg.devVerify && dev ? {dev_verification_code: dev} : {})}); }));
  r.post('/login', lim, h(async (q, s) => {
    const em = email(q.body.email), pw = String(q.body.password || ''), u = await byEmail(em), good = A.checkPassword(pw, u ? u.password_hash : 'x:00');
    if (!u || !good) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong email or password.');
    if (u.status !== 'active') throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact info@buye.online.');
    if (!u.email_verified) throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email first.');
    await setCookie(s, u.id); ok(s, {user: await pub(u)});
  }));
  r.get('/me', requireAuth, h(async (q, s) => {
    const m = await membership(db, q.user.id), p = (await db.query("SELECT p.id,p.name,array_to_string(p.features,',') AS features FROM plans p WHERE p.id = COALESCE((SELECT plan_id FROM subscriptions WHERE status='active' AND ends_at>now() AND (user_id=$1 OR company_id=$2) ORDER BY ends_at DESC LIMIT 1),'free')", [q.user.id, m ? m.company_id : null])).rows[0];
    ok(s, {...(await pub(q.user)), plan: p});
  }));
  r.post('/logout', h(async (q, s) => { if (q.cookies.ia_sid) await db.query('DELETE FROM sessions WHERE token_hash=$1', [A.hmac(q.cookies.ia_sid)]); s.clearCookie('ia_sid', {path: '/'}); ok(s, {}); }));
  r.post('/forgot', lim, h(async (q, s) => { const u = await byEmail(email(q.body.email)); let dev; if (u && u.email_verified) dev = await issueCode(u, 'reset'); ok(s, {message: 'If the account exists, a reset code has been sent.', ...(cfg.devVerify && dev ? {dev_reset_code: dev} : {})}); }));
  r.post('/reset', lim, h(async (q, s) => {
    const u = await byEmail(email(q.body.email)), pw = password(q.body.password); if (!u) throw new ApiError(400, 'INVALID_CODE', 'Invalid or expired code.');
    await useCode(u, 'reset', q.body.code); await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [u.id, A.hashPassword(pw)]); await db.query('DELETE FROM sessions WHERE user_id=$1', [u.id]); ok(s, {message: 'Password updated.'});
  }));
  r.post('/google', lim, h(async (q, s) => { if (!process.env.GOOGLE_CLIENT_ID) throw new ApiError(503, 'NOT_CONFIGURED', 'Google sign-in is not configured.'); let u; try { u = await A.googleLogin(db, q.body.credential); } catch (e) { throw bad(e.message || 'Google sign-in failed'); } await setCookie(s, u.id); ok(s, {user: await pub(u)}); }));
  return r;
};
