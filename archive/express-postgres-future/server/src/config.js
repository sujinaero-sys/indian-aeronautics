const fs = require('fs'), path = require('path');
try { fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').split('\n').forEach(l => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]; }); } catch {}
const env = process.env.NODE_ENV || 'development', isProd = env === 'production';
if (isProd) { for (const k of ['DATABASE_URL', 'APP_SECRET', 'FRONTEND_ORIGIN']) { if (!process.env[k]) throw new Error('Missing required env var in production: ' + k); } }
else { process.env.APP_SECRET = process.env.APP_SECRET || 'dev-only-secret-not-for-production'; }
module.exports = {
  env, isProd, port: Number(process.env.PORT || 3000),
  databaseUrl: env === 'test' ? (process.env.TEST_DATABASE_URL || process.env.DATABASE_URL) : process.env.DATABASE_URL,
  frontendOrigin: process.env.FRONTEND_ORIGIN || '',
  devVerify: !isProd && ['development', 'test'].includes(env),   // dev-only verification shortcuts; can never be on in production
  emailEnabled: !!process.env.RESEND_API_KEY,
  authLimit: env === 'test' ? 10000 : 20,
  razorpay: {keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET},
  staticDir: isProd ? null : path.join(__dirname, '../../frontend'),
};
