const cfg = require('./config'), db = require('./db'), {createApp} = require('./app'), mail = require('./mail');
const app = createApp(db, cfg);
async function work() { const j = (await db.query("UPDATE job_queue SET status='running',attempts=attempts+1 WHERE id=(SELECT id FROM job_queue WHERE status='queued' AND run_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *")).rows[0]; if (!j) return;
  try { if (j.kind === 'email' && cfg.emailEnabled) { const u = (await db.query('SELECT email,name FROM users WHERE id=$1', [j.payload.user_id])).rows[0]; await mail.send(db, u.email, j.payload.template, {name: u.name, invoice: j.payload.invoice || ''}); } await db.query("UPDATE job_queue SET status='done' WHERE id=$1", [j.id]); }
  catch (e) { await db.query("UPDATE job_queue SET status=$2, run_at=now()+interval '5 minutes' WHERE id=$1", [j.id, j.attempts >= 5 ? 'failed' : 'queued']); } }
setInterval(() => work().catch(() => {}), 5000);
app.listen(cfg.port, () => console.log(`IA server (${cfg.env}) on :${cfg.port}`));
