// Plans, payments (Razorpay verified server-side), courses, trainer earnings, dashboard, analytics
function planOf_(u) {
  const now = Date.now(), subs = all_('Subscriptions').filter(s => s.status === 'Active' && new Date(s.end).getTime() > now && (s.user_id === u.id || (u.company_id && s.company_id === u.company_id)));
  const id = subs.length ? subs.sort((a, b) => new Date(b.end) - new Date(a.end))[0].plan_id : 'free', p = one_('Plans', x => x.id === id) || {id: 'free', name: 'Free', features: 'basic_profile'};
  return {id: p.id, name: p.name, features: String(p.features)};
}
const hex_ = bytes => bytes.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
const prop_ = k => PropertiesService.getScriptProperties().getProperty(k);
const rzpAuth_ = () => 'Basic ' + Utilities.base64Encode(prop_('RZP_KEY_ID') + ':' + prop_('RZP_KEY_SECRET'));
function activate_(p, actor) {   // single place that turns a verified payment into a subscription (idempotent)
  if (p.status === 'Paid') return; const pl = one_('Plans', x => x.id === p.plan_id), n = all_('Payments').filter(x => x.invoice_no).length + 1, inv = 'INV-IA-' + new Date().getFullYear() + '-' + ('0000' + n).slice(-4), end = new Date(Date.now() + Number(pl.duration_days || 365) * 864e5);
  set_('Payments', p.id, {status: 'Paid', invoice_no: inv}); all_('Subscriptions').filter(s => s.user_id === p.user_id && s.status === 'Active').forEach(s => set_('Subscriptions', s.id, {status: 'Replaced'}));
  add_('Subscriptions', {user_id: p.user_id, company_id: p.company_id, plan_id: p.plan_id, status: 'Active', start: new Date(), end}); notify_(p.user_id, 'Payment confirmed. ' + pl.name + ' plan active. Invoice ' + inv);
  const us = one_('Users', x => x.id === p.user_id); mail_(us && us.email, 'payment_success', {name: us && us.name, plan: pl.name, invoice: inv, end: end.toDateString()}); audit_(actor || us, 'payment_paid', p.id + ' ' + inv);
}
const monthKey_ = d => String(d).slice(0, 7);
function monthly_(rows, dateField, valFn) { const m = {}; rows.forEach(r => { const k = monthKey_(r[dateField]); if (k.length === 7) m[k] = (m[k] || 0) + (valFn ? valFn(r) : 1); }); const ks = Object.keys(m).sort(); return {labels: ks, values: ks.map(k => m[k])}; }
function dist_(rows, f) { const m = {}; rows.forEach(r => { const k = String(typeof f === 'function' ? f(r) : r[f]) || 'Unspecified'; m[k] = (m[k] || 0) + 1; }); const ks = Object.keys(m); return {labels: ks, values: ks.map(k => m[k])}; }
const chart_ = (id, title, type, d) => Object.assign({id, title, type}, d);
const commission_ = () => Number(S_('commission_pct') || 20);

function activateFree_(u) {
  const existing = all_('Subscriptions').find(s =>
    s.user_id === u.id &&
    s.status === 'Active' &&
    new Date(s.end).getTime() > Date.now()
  );
  if (existing) {
    if (existing.plan_id === 'free') return {message: 'Free Basic Profile is already active.', plan_id: 'free'};
    fail_('You already have an active ' + existing.plan_id + ' plan.');
  }
  const start = new Date();
  const end = new Date(Date.now() + 365 * 864e5);
  add_('Subscriptions', {
    user_id: u.id,
    company_id: u.company_id || '',
    plan_id: 'free',
    status: 'Active',
    start,
    end
  });
  notify_(u.id, 'Free Basic Profile activated until ' + end.toDateString());
  audit_(u, 'free_plan_activated', 'free');
  return {message: 'Free Basic Profile activated successfully.', plan_id: 'free', start, end};
}
function moneyH_() { return {
  free_activate(b, u) { return activateFree_(u); },
  checkout(b, u) {
    const p = one_('Plans', x => x.id === b.plan_id && T_(x.active)); if (!p) fail_('Plan not found'); if (Number(p.price_inr) === 0) fail_('This plan needs no payment. Contact ' + S_('support_email') + ' for Enterprise.'); limit_('co' + u.id, 10, 3600);
    const amount = Math.round(Number(p.price_inr) * (1 + Number(p.tax_pct || 0) / 100) * 100) / 100, ref = 'PAY-' + uid_().toUpperCase();
    if (prop_('RZP_KEY_ID') && prop_('RZP_KEY_SECRET')) {
      const r = UrlFetchApp.fetch('https://api.razorpay.com/v1/orders', {method: 'post', contentType: 'application/json', headers: {Authorization: rzpAuth_()}, payload: JSON.stringify({amount: Math.round(amount * 100), currency: 'INR', receipt: ref}), muteHttpExceptions: true});
      if (r.getResponseCode() !== 200) fail_('Payment gateway error. Please try again.'); const o = JSON.parse(r.getContentText());
      add_('Payments', {user_id: u.id, company_id: u.company_id || '', plan_id: p.id, amount, status: 'Created', ref, order_id: o.id}); return {order_id: o.id, key_id: prop_('RZP_KEY_ID'), amount, currency: 'INR', ref};
    }
    if (p.payment_link) { add_('Payments', {user_id: u.id, company_id: u.company_id || '', plan_id: p.id, amount, status: 'Pending', ref}); return {link: p.payment_link, ref, amount}; }
    fail_('Online payment is not enabled yet. Contact ' + S_('support_email') + ' or WhatsApp ' + S_('whatsapp'));
  },
  payment_verify(b, u) {   // authoritative check: HMAC signature AND a server-to-server fetch of the payment from Razorpay
    need_(b, ['order_id','payment_id','signature']); const p = one_('Payments', x => x.order_id === b.order_id && x.user_id === u.id); if (!p) fail_('Order not found'); if (p.status === 'Paid') return {status: 'Paid'};
    if (all_('Payments').some(x => x.rzp_payment_id === b.payment_id && x.id !== p.id)) fail_('Payment already used');
    const sig = hex_(Utilities.computeHmacSha256Signature(b.order_id + '|' + b.payment_id, prop_('RZP_KEY_SECRET')));
    const bad = why => { set_('Payments', p.id, {status: 'Failed'}); audit_(u, 'payment_rejected', p.ref + ' ' + why); mail_(u.email, 'payment_failure', {name: u.name, ref: p.ref}); fail_('Payment could not be verified. No plan change was made.'); };
    if (sig !== b.signature) bad('signature');
    const r = UrlFetchApp.fetch('https://api.razorpay.com/v1/payments/' + encodeURIComponent(b.payment_id), {headers: {Authorization: rzpAuth_()}, muteHttpExceptions: true}); if (r.getResponseCode() !== 200) bad('fetch');
    const g = JSON.parse(r.getContentText()); if (g.order_id !== p.order_id || g.currency !== 'INR' || Number(g.amount) !== Math.round(Number(p.amount) * 100)) bad('amount/order mismatch');
    if (g.status === 'authorized') { set_('Payments', p.id, {status: 'Authorized', rzp_payment_id: b.payment_id}); return {status: 'Authorized'}; } if (g.status !== 'captured') bad('status ' + g.status);
    set_('Payments', p.id, {rzp_payment_id: b.payment_id}); activate_(Object.assign(p, {rzp_payment_id: b.payment_id})); return {status: 'Paid'};
  },
  payment_confirm(b, u) { const p = one_('Payments', x => x.id === b.id); if (!p || p.status === 'Paid') fail_('Not found or already paid'); activate_(p, u); },
  payments_mine: (b, u) => ({data: all_('Payments').filter(p => p.user_id === u.id || (u.company_id && p.company_id === u.company_id && ['owner', 'admin'].indexOf(u.company_role) >= 0)).reverse().map(p => pick_(p, ['id','created','ref','plan_id','amount','status','invoice_no'])), subs: all_('Subscriptions').filter(s => s.user_id === u.id).reverse()}),
  refund_request(b, u) { const p = one_('Payments', x => x.id === b.id && x.user_id === u.id && x.status === 'Paid'); if (!p) fail_('Payment not found'); set_('Payments', p.id, {status: 'Refund Requested'}); adminMail_('Refund request', p.ref); },
  refund_done(b, u) { const p = one_('Payments', x => x.id === b.id && ['Refund Requested', 'Paid'].indexOf(x.status) >= 0); if (!p) fail_('Not found'); set_('Payments', p.id, {status: 'Refunded'}); all_('Subscriptions').filter(s => s.user_id === p.user_id && s.status === 'Active' && s.plan_id === p.plan_id).forEach(s => set_('Subscriptions', s.id, {status: 'Cancelled'})); audit_(u, 'refund_done', p.ref); notify_(p.user_id, 'Your refund for ' + p.ref + ' has been processed.'); },
  sub_cancel(b, u) { all_('Subscriptions').filter(s => s.user_id === u.id && s.status === 'Active').forEach(s => set_('Subscriptions', s.id, {status: 'Cancelled'})); audit_(u, 'sub_cancel', ''); return {message: 'Subscription cancelled. See the Refund Policy for refunds.'}; },

  // ---- academy ----
  course_submit(b, u) { if (roles_(u).indexOf('trainer') < 0 && !isAdmin_(u)) fail_('Trainer accounts only'); need_(b, ['title','description']); const f = {}; ['title','description','category','duration','mode','curriculum','price','certificate','start_date'].forEach(k => f[k] = clean_(b[k])); add_('Courses', Object.assign(f, {status: 'Pending', trainer_id: u.id, trainer_name: u.name})); adminMail_('Course submitted', b.title); return {message: 'Submitted for admin approval.'}; },
  enrol(b, u) { const c = one_('Courses', x => x.id === b.course_id && x.status === 'Approved'); if (!c) fail_('Course not available'); if (one_('Enrolments', x => x.course_id === c.id && x.user_id === u.id)) fail_('You are already enrolled'); const price = Number(c.price || 0);
    add_('Enrolments', {course_id: c.id, user_id: u.id, status: price ? 'Awaiting payment' : 'Active', amount: price, paid: price ? 'FALSE' : 'TRUE', refunded: 0, progress: 0, certificate: 'FALSE'}); notify_(c.trainer_id, 'New enrolment: ' + u.name); if (!roles_(u).includes('student')) { const rs = roles_(u); rs.push('student'); set_('Users', u.id, {roles: rs.join(',')}); } return {message: price ? 'Enrolment requested. It activates once payment is confirmed (' + S_('support_email') + ').' : 'Enrolled.'}; },
  my_courses: (b, u) => ({data: all_('Enrolments').filter(e => e.user_id === u.id).map(e => { const c = one_('Courses', x => x.id === e.course_id) || {}; return {id: e.id, course_id: e.course_id, title: c.title, trainer_id: c.trainer_id, trainer_name: c.trainer_name, status: e.status, paid: T_(e.paid), progress: Number(e.progress || 0), certificate: T_(e.certificate), start_date: c.start_date}; })}),
  course_students(b, u) { const cs = all_('Courses').filter(c => c.trainer_id === u.id), ids = cs.map(c => c.id); return {courses: cs, data: all_('Enrolments').filter(e => ids.indexOf(e.course_id) >= 0).map(e => ({id: e.id, course: (cs.find(c => c.id === e.course_id) || {}).title, course_id: e.course_id, user_id: e.user_id, student: (one_('Users', x => x.id === e.user_id) || {}).name, status: e.status, paid: T_(e.paid), progress: Number(e.progress || 0), certificate: T_(e.certificate)}))}; },
  enrol_update(b, u) { const e = one_('Enrolments', x => x.id === b.id), c = e && one_('Courses', x => x.id === e.course_id); if (!c || (c.trainer_id !== u.id && !isAdmin_(u))) fail_('Not allowed'); const p = {};
    if (b.progress !== undefined) p.progress = Math.max(0, Math.min(100, Number(b.progress) || 0)); if (b.certificate !== undefined) p.certificate = T_(b.certificate) ? 'TRUE' : 'FALSE'; set_('Enrolments', e.id, p); if (p.certificate === 'TRUE') notify_(e.user_id, 'Your certificate for ' + c.title + ' is available.'); },
  enrol_pay(b, u) { const e = one_('Enrolments', x => x.id === b.id); if (!e) fail_('Not found'); set_('Enrolments', e.id, {paid: 'TRUE', status: 'Active', amount: b.amount !== undefined ? Number(b.amount) : e.amount}); notify_(e.user_id, 'Your course payment is confirmed. You are enrolled.'); audit_(u, 'enrol_pay', e.id); },
  enrol_refund(b, u) { const e = one_('Enrolments', x => x.id === b.id); if (!e) fail_('Not found'); set_('Enrolments', e.id, {refunded: Number(e.amount || 0), status: 'Refunded'}); audit_(u, 'enrol_refund', e.id); },
  discussion_list(b, u) { const c = one_('Courses', x => x.id === b.course_id); if (!c || (c.trainer_id !== u.id && !one_('Enrolments', e => e.course_id === c.id && e.user_id === u.id && e.status === 'Active') && !isAdmin_(u))) fail_('Not allowed'); return {course: c.title, data: all_('Discussions').filter(d => d.course_id === c.id).slice(-100).map(d => pick_(d, ['id','created','name','kind','body']))}; },   // no contact details are shared between students
  discussion_post(b, u) { const c = one_('Courses', x => x.id === b.course_id); const isTr = c && c.trainer_id === u.id; if (!c || (!isTr && !one_('Enrolments', e => e.course_id === c.id && e.user_id === u.id && e.status === 'Active'))) fail_('Not allowed'); need_(b, ['body']); limit_('d' + u.id, 20, 600);
    const kind = isTr && b.kind === 'announcement' ? 'announcement' : (b.kind === 'reply' ? 'reply' : 'question'); add_('Discussions', {course_id: c.id, user_id: u.id, name: u.name, kind, body: clean_(b.body).slice(0, 2000)}); if (kind === 'announcement') all_('Enrolments').filter(e => e.course_id === c.id).forEach(e => notify_(e.user_id, 'Announcement in ' + c.title)); },
  earnings(b, u) {   // Gross âˆ’ refunds âˆ’ platform commission = trainer net (commission % comes from Settings)
    const cs = all_('Courses').filter(c => c.trainer_id === u.id), ids = cs.map(c => c.id), es = all_('Enrolments').filter(e => ids.indexOf(e.course_id) >= 0), pct = commission_();
    const gross = es.filter(e => T_(e.paid)).reduce((n, e) => n + Number(e.amount || 0), 0), refunds = es.reduce((n, e) => n + Number(e.refunded || 0), 0), fee = Math.round((gross - refunds) * pct) / 100, net = Math.round((gross - refunds - fee) * 100) / 100;
    const po = all_('Payouts').filter(p => p.trainer_id === u.id), sum = s => po.filter(p => s.indexOf(p.status) >= 0).reduce((n, p) => n + Number(p.amount || 0), 0), paid = sum(['Paid']), processing = sum(['Processing', 'Eligible']);
    return {enrolments: es.length, gross, refunds, commission_pct: pct, platform_fee: fee, net, paid_out: paid, in_process: processing, pending: Math.round((net - paid - processing) * 100) / 100, payouts: po, formula: 'Gross ' + gross + ' âˆ’ refunds ' + refunds + ' âˆ’ platform commission (' + pct + '%) ' + fee + ' = net ' + net};
  },
  payout_create(b, u) { need_(b, ['trainer_id','amount']); if (!one_('Users', x => x.id === b.trainer_id)) fail_('Trainer not found'); const p = add_('Payouts', {trainer_id: b.trainer_id, amount: Number(b.amount), status: 'Pending', note: clean_(b.note)}); audit_(u, 'payout_create', p.id); return {id: p.id}; },
  payout_set(b, u) { const p = one_('Payouts', x => x.id === b.id); if (!p || ['Pending','Eligible','Processing','Paid','Failed','On Hold'].indexOf(b.status) < 0) fail_('Invalid'); set_('Payouts', p.id, {status: b.status, note: clean_(b.note || p.note)}); audit_(u, 'payout_' + b.status, p.id); if (b.status === 'Paid') notify_(p.trainer_id, 'A payout of â‚¹' + p.amount + ' was marked paid.'); },

  // ---- dashboard + analytics (real data only; empty series => "Not enough data yet" in the UI) ----
  dashboard(b, u) {
    const co = coOf_(u), plan = planOf_(u), rfqs = all_('RFQs').filter(r => isBuyerSide_(u, r)), qs = all_('Quotes'), cos = rfqs.length ? all_('Companies').filter(c => c.status === 'Approved' && !c.merged_into) : [];
    const d = {role: pubUser_(u).role, roles: roles_(u), plan: plan.name, plan_id: plan.id, company_role: u.company_role || null, company: co ? {id: co.id, name: co.name, status: co.status, verification: co.verification, completion: completion_(co)} : null,
      rfqs: rfqs.reverse().slice(0, 50).map(r => ({id: r.id, rfq_no: r.rfq_no, title: r.title, status: r.status, created: r.created, responses: qs.filter(q => q.rfq_id === r.id).length, matched: match_(r, cos).length}))};
    d.saved = all_('Saved').filter(s => s.user_id === u.id).length; d.unread = all_('Messages').filter(m => m.to_id === u.id && !T_(m.read)).length; d.notifications_unread = all_('Notifications').filter(n => n.user_id === u.id && !T_(n.read)).length;
    if (co) { d.quotes_sent = qs.filter(q => q.company_id === co.id).length; d.enquiries = all_('Leads').filter(l => l.company_id === co.id).length; d.rfq_opps = all_('RFQs').filter(r => r.owner_id !== u.id && canSee_(u, r) && rfqLive_(r)).length; if (plan.features.indexOf('analytics') >= 0) d.views = Number(co.views || 0); }
    return d;
  },
  analytics(b, u) {
    const charts = [], co = coOf_(u);
    if (isAdmin_(u) && b.scope === 'admin') {
      const U = all_('Users'), C = all_('Companies'), R = all_('RFQs'), P = all_('Payments').filter(p => p.status === 'Paid'), subs = all_('Subscriptions').filter(s => s.status === 'Active');
      charts.push(chart_('reg', 'Monthly registrations', 'bar', monthly_(U, 'created')), chart_('rfq', 'Monthly RFQs', 'bar', monthly_(R, 'created')), chart_('rev', 'Monthly revenue (â‚¹)', 'bar', monthly_(P, 'created', p => Number(p.amount))), chart_('roles', 'Users by role', 'bar', dist_(U, u2 => roles_(u2)[0])), chart_('plans', 'Active subscriptions by plan', 'bar', dist_(subs, 'plan_id')), chart_('ind', 'Companies by industry', 'bar', dist_(C.filter(c => !c.merged_into), 'industry')));
      return {charts, totals: {users: U.length, companies: C.filter(c => !c.merged_into).length, verified: C.filter(c => c.verification !== 'Basic Profile' && c.verification).length, rfqs: R.length, jobs: all_('Jobs').length, courses: all_('Courses').length, mro: C.filter(c => /mro/i.test([c.type, c.industry].join(' '))).length, revenue: P.reduce((n, p) => n + Number(p.amount), 0), subscriptions: subs.length}};
    }
    const mine = all_('RFQs').filter(r => isBuyerSide_(u, r)), qs = all_('Quotes');
    if (mine.length) charts.push(chart_('rfqm', 'RFQs by month', 'bar', monthly_(mine, 'created')), chart_('rfqs', 'RFQ status', 'bar', dist_(mine, 'status')), chart_('resp', 'Responses per RFQ', 'bar', {labels: mine.map(r => r.rfq_no), values: mine.map(r => qs.filter(q => q.rfq_id === r.id).length)}));
    if (co) { const mq = qs.filter(q => q.company_id === co.id), leads = all_('Leads').filter(l => l.company_id === co.id), views = all_('Views').filter(v => v.company_id === co.id);
      charts.push(chart_('views', 'Profile views by day', 'bar', {labels: views.map(v => String(v.date).slice(0, 10)), values: views.map(v => Number(v.count))}), chart_('enq', 'Enquiries by month', 'bar', monthly_(leads, 'created')), chart_('leads', 'Lead status', 'bar', dist_(leads, 'status')), chart_('quotes', 'Quotations sent by month', 'bar', monthly_(mq, 'created'))); }
    if (roles_(u).indexOf('trainer') >= 0) { const ids = all_('Courses').filter(c => c.trainer_id === u.id).map(c => c.id), es = all_('Enrolments').filter(e => ids.indexOf(e.course_id) >= 0); charts.push(chart_('enrol', 'Enrolments by month', 'bar', monthly_(es, 'created')), chart_('trev', 'Course revenue by month (â‚¹)', 'bar', monthly_(es.filter(e => T_(e.paid)), 'created', e => Number(e.amount || 0)))); }
    return {charts: charts.filter(c => c.values.length > 0)};
  },
}; }

