const crypto = require('crypto');
const SECRET = () => process.env.APP_SECRET || fail('APP_SECRET not set'); function fail(m) { throw new Error(m); }
const hmac = s => crypto.createHmac('sha256', SECRET()).update(String(s)).digest('hex');
const hashPassword = pw => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
const checkPassword = (pw, stored) => { const [salt, h] = String(stored || '').split(':'); if (!h) return false; const x = crypto.scryptSync(pw, salt, 64); const y = Buffer.from(h, 'hex'); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const newCode = () => String(crypto.randomInt(100000, 1000000));
const newToken = () => crypto.randomBytes(32).toString('hex');
async function createSession(db, userId) { const t = newToken(); await db.query("INSERT INTO sessions VALUES($1,$2,now()+interval '7 days')", [hmac(t), userId]); return t; }
async function userFromToken(db, t) { if (!t) return null; return (await db.query("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.status='active'", [hmac(t)])).rows[0] || null; }
// Google sign-in: official OIDC ID-token verification. Links to an existing account only when BOTH emails are verified.
async function googleLogin(db, idToken) {
  const {OAuth2Client} = require('google-auth-library'), cl = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  const p = (await cl.verifyIdToken({idToken, audience: process.env.GOOGLE_CLIENT_ID})).getPayload();
  if (!p.email_verified) throw new Error('Google email is not verified');
  let u = (await db.query('SELECT * FROM users WHERE google_sub=$1', [p.sub])).rows[0];
  if (!u) { u = (await db.query('SELECT * FROM users WHERE email=$1', [p.email.toLowerCase()])).rows[0];
    if (u) { if (!u.email_verified) throw new Error('Verify your email with your password account first, then link Google.'); await db.query('UPDATE users SET google_sub=$2 WHERE id=$1', [u.id, p.sub]); }
    else u = (await db.query("INSERT INTO users(email,name,google_sub,email_verified) VALUES($1,$2,$3,true) RETURNING *", [p.email.toLowerCase(), p.name || p.email, p.sub])).rows[0]; }
  return u;
}
module.exports = {hmac, hashPassword, checkPassword, newCode, newToken, createSession, userFromToken, googleLogin};
