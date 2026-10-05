const crypto = require('crypto');
function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const exp = crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), a = Buffer.from(exp), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Authoritative payment handler. db = pg Pool. Idempotent via webhook_events primary key; amount/currency validated against our own order record.
async function handleRazorpayEvent(db, eventId, ev) {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const ins = await c.query("INSERT INTO webhook_events(event_id,provider,type) VALUES($1,'razorpay',$2) ON CONFLICT DO NOTHING RETURNING event_id", [eventId, ev.event]);
    if (!ins.rowCount) { await c.query('ROLLBACK'); return 'duplicate'; }
    const ent = ev.payload && (ev.payload.payment || ev.payload.refund || {}).entity; if (!ent) { await c.query('COMMIT'); return 'ignored'; }
    const orderId = ent.order_id, pay = orderId && (await c.query('SELECT * FROM payments WHERE provider_order_id=$1 FOR UPDATE', [orderId])).rows[0];
    if (!pay) { await c.query("UPDATE webhook_events SET outcome='unknown order' WHERE event_id=$1", [eventId]); await c.query('COMMIT'); return 'unknown order'; }
    let outcome = 'ok';
    if (ev.event === 'payment.captured') {
      if (Number(ent.amount) !== Number(pay.amount_paise) || ent.currency !== pay.currency) outcome = 'amount mismatch';
      else if (pay.status !== 'Paid') {
        const inv = 'INV-IA-' + new Date().getFullYear() + '-' + String((await c.query("SELECT count(*)+1 n FROM payments WHERE invoice_no IS NOT NULL")).rows[0].n).padStart(5, '0');
        await c.query("UPDATE payments SET status='Paid', provider_payment_id=$2, invoice_no=$3 WHERE id=$1", [pay.id, ent.id, inv]);
        const plan = (await c.query('SELECT duration_days FROM plans WHERE id=$1', [pay.plan_id])).rows[0];
        await c.query("INSERT INTO subscriptions(user_id,company_id,plan_id,payment_id,starts_at,ends_at) VALUES($1,$2,$3,$4,now(), now() + ($5 || ' days')::interval) ON CONFLICT (payment_id) DO NOTHING", [pay.user_id, pay.company_id, pay.plan_id, pay.id, String(plan.duration_days)]);
        await c.query("INSERT INTO job_queue(kind,payload) VALUES('email',$1)", [JSON.stringify({template: 'payment_success', user_id: pay.user_id, invoice: inv})]);
        await c.query("INSERT INTO notifications(user_id,kind,text) VALUES($1,'subscription',$2)", [pay.user_id, 'Payment confirmed. Your ' + pay.plan_id + ' plan is active. Invoice ' + inv]);
      }
    } else if (ev.event === 'payment.failed') {
      if (pay.status !== 'Paid') await c.query("UPDATE payments SET status='Failed' WHERE id=$1", [pay.id]);
      await c.query("INSERT INTO job_queue(kind,payload) VALUES('email',$1)", [JSON.stringify({template: 'payment_failure', user_id: pay.user_id})]);
    } else if (ev.event === 'refund.processed') {
      await c.query("UPDATE payments SET status='Refunded' WHERE id=$1", [pay.id]); await c.query("UPDATE subscriptions SET status='cancelled' WHERE payment_id=$1", [pay.id]);
    }
    await c.query('UPDATE webhook_events SET outcome=$2 WHERE event_id=$1', [eventId, outcome]);
    await c.query("INSERT INTO audit_log(action,detail) VALUES('webhook',$1)", [JSON.stringify({eventId, type: ev.event, outcome})]);
    await c.query('COMMIT'); return outcome;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
module.exports = {verifySignature, handleRazorpayEvent};
