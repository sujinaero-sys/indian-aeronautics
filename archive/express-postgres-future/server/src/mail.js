// Transactional email via Resend (https://resend.com). Sender and templates come from the database, not code.
async function send(db, to, templateKey, vars = {}) {
  const t = (await db.query('SELECT * FROM email_templates WHERE key=$1', [templateKey])).rows[0]; if (!t) throw new Error('Missing template ' + templateKey);
  const set = Object.fromEntries((await db.query("SELECT key,value FROM settings WHERE key IN ('sender_name','sender_email','support_email','whatsapp')")).rows.map(r => [r.key, r.value]));
  const fill = s => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? set[k] ?? ''), log = (await db.query("INSERT INTO email_log(to_email,template) VALUES($1,$2) RETURNING id", [to, templateKey])).rows[0];
  const r = await fetch('https://api.resend.com/emails', {method: 'POST', headers: {Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json'},
    body: JSON.stringify({from: `${set.sender_name} <${set.sender_email}>`, to, subject: fill(t.subject), text: fill(t.body)})}), j = await r.json().catch(() => ({}));
  await db.query('UPDATE email_log SET status=$2, provider_id=$3 WHERE id=$1', [log.id, r.ok ? 'sent' : 'failed', j.id || null]); if (!r.ok) throw new Error('Email failed');
}
module.exports = {send};
