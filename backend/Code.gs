/** IA.BUYE.ONLINE — complete backend on Google Apps Script + Google Sheets + one Drive folder.
 *  Files: Code.gs (core, auth, router) · Company.gs · Market.gs · Money.gs · Admin.gs
 *  Setup: paste all .gs files, run setup() once, then Deploy > Web app (Execute as: Me, Access: Anyone). */
const FIELDS = ['name','description','website','email','phone','country','state','city','address','industry','category','type','products','services','capabilities','materials','certifications','contact_person','size','founded','export'];
const SCHEMA = {
  Companies: ['id','created','status','verification','owner_id','merged_into','views'].concat(FIELDS),
  Users: ['id','created','email','name','phone','roles','status','salt','hash','google_sub','company_id','company_role','marketing','code','code_exp'],
  Sessions: ['token','user_id','exp'],
  Invites: ['id','created','company_id','email','name','role','token_hash','exp','status'],
  Claims: ['id','created','status','company_id','user_id','designation','company_email','phone','info'],
  RFQs: ['id','created','status','visibility','rfq_no','owner_id','company_id','title','description','category','quantity','unit','material','process','certification','location','delivery_date','budget','file_ids','invited','buyer_company','buyer_name','buyer_email','buyer_phone'],
  Quotes: ['id','created','status','rfq_id','user_id','company_id','company_name','price','currency','moq','lead_time','terms','validity','comments','file_ids'],
  Messages: ['id','created','thread','from_id','to_id','body','file_ids','read'],
  Blocks: ['id','user_id','blocked_id'],
  Files: ['id','created','owner_id','name','type','size','drive_id','rfq_id','scan_status'],
  Notifications: ['id','created','user_id','text','link','read'],
  Plans: ['id','name','price_inr','duration_days','features','limits','tax_pct','payment_link','active'],
  Subscriptions: ['id','created','user_id','company_id','plan_id','status','start','end'],
  Payments: ['id','created','user_id','company_id','plan_id','amount','status','ref','order_id','rzp_payment_id','invoice_no'],
  Jobs: ['id','created','status','company_id','title','company','city','state','type','description','apply_email'],
  Applications: ['id','created','job_id','user_id','name','message','status'],
  Leads: ['id','created','status','company_id','buyer_name','buyer_email','buyer_phone','requirement','est_value','follow_up','notes'],
  Courses: ['id','created','status','title','description','category','trainer_id','trainer_name','duration','mode','curriculum','price','certificate','start_date'],
  Enrolments: ['id','created','course_id','user_id','status','amount','paid','refunded','progress','certificate'],
  Discussions: ['id','created','course_id','user_id','name','kind','body'],
  Payouts: ['id','created','trainer_id','amount','status','note'],
  Saved: ['id','user_id','company_id'],
  Settings: ['key','value'],
  Templates: ['key','subject','body'],
  Outbox: ['id','created','to','subject','body','status','attempts','error'],
  Tickets: ['id','created','status','name','email','company','subject','message','user_id'],
  Merges: ['id','created','admin_id','existing_id','duplicate_id','changes','previous','undone'],
  Imports: ['id','created','admin_id','file','made','merged','skipped','errors'],
  Views: ['id','date','company_id','count'],
  Audit: ['id','created','user_id','action','detail'],
  Errors: ['id','created','action','message'],
};
const PERMS = {
  owner: ['company.manage','team.manage','rfq.create','rfq.responses','quote.manage','lead.manage','rfq.respond','job.manage','applications.view','capability.manage','analytics.company','company.view'],
  admin: ['company.manage','team.manage','analytics.company','company.view','capability.manage'],
  procurement: ['rfq.create','rfq.responses','quote.manage','company.view'],
  sales: ['lead.manage','rfq.respond','company.view','analytics.company'],
  hr: ['job.manage','applications.view','company.view'],
  engineering: ['capability.manage','rfq.respond','company.view'],
  viewer: ['company.view'],
};
const SETTINGS_DEFAULT = [['support_email','info@buye.online'],['whatsapp','+919995863184'],['sender_name','Indian Aeronautics'],['sender_email','info@buye.online'],['admin_email',''],['site_url','https://ia.buye.online'],['commission_pct',20],['max_file_mb',5],['allowed_ext','pdf,doc,docx,xls,xlsx,csv,jpg,jpeg,png'],['require_scan_for_sharing','TRUE'],['dev_show_codes','FALSE'],['google_client_id',''],['rfq_counter',0],['last_backup',''],['platform_name','Indian Aeronautics']];
const SETTINGS_EDITABLE = ['support_email','whatsapp','sender_name','sender_email','admin_email','site_url','commission_pct','max_file_mb','allowed_ext','require_scan_for_sharing','dev_show_codes','google_client_id','platform_name'];
const PLAN_SEED = [['free','Free',0,365,'basic_profile','{"enquiries":10}',18,'',true],['professional','Professional',4999,365,'basic_profile,enhanced_profile,rfq_access,analytics','{}',18,'',true],['business','Business',14999,365,'basic_profile,enhanced_profile,rfq_access,analytics,lead_mgmt,priority,multi_user','{}',18,'',true],['enterprise','Enterprise',0,365,'basic_profile,enhanced_profile,rfq_access,analytics,lead_mgmt,priority,multi_user,intelligence,api,support','{}',18,'',true]];
const TEMPLATE_SEED = [
 ['email_verification','Your Indian Aeronautics verification code','Hello {{name}},\n\nYour verification code is {{code}}. It expires in 15 minutes.\n\nSupport: {{support_email}} | WhatsApp {{whatsapp}}'],
 ['password_reset','Reset your Indian Aeronautics password','Hello {{name}},\n\nYour password reset code is {{code}} (valid 15 minutes). If you did not ask for this, ignore this email.\n\nSupport: {{support_email}}'],
 ['company_invitation','You have been invited to join {{company}} on IA.BUYE.ONLINE','Hello {{name}},\n\nYou have been invited to join {{company}} on IA.BUYE.ONLINE as {{role}}.\nAccept here (valid 7 days): {{link}}\n\nSupport: {{support_email}}'],
 ['payment_success','Payment confirmed — {{invoice}}','Hello {{name}},\n\nYour payment is confirmed and your {{plan}} plan is active until {{end}}. Invoice: {{invoice}}.\n\nSupport: {{support_email}} | WhatsApp {{whatsapp}}'],
 ['payment_failure','Your payment could not be verified','Hello {{name}},\n\nWe could not verify your payment. No plan change was made. Contact {{support_email}} or WhatsApp {{whatsapp}} with your reference {{ref}}.'],
 ['claim_result','Your company claim: {{result}}','Hello {{name}},\n\nYour claim for {{company}} was {{result}}.\n\nSupport: {{support_email}}'],
 ['rfq_response','New quotation on {{rfq}}','Hello {{name}},\n\n{{supplier}} responded to {{rfq}}. Log in to review: {{link}}'],
 ['contact_ack','We received your message','Hello {{name}},\n\nThanks for contacting Indian Aeronautics. We will reply to this email address. Reference {{ref}}.\n\nEmail {{support_email}} | WhatsApp {{whatsapp}}'],
];

// ---------- sheet helpers ----------
const ss_ = () => SpreadsheetApp.getActiveSpreadsheet();
const uid_ = () => Utilities.getUuid().slice(0, 8);
function fail_(m) { const e = new Error(m); e.user = true; throw e; }
const T_ = v => v === true || String(v).toUpperCase() === 'TRUE';
const clean_ = v => String(v == null ? '' : v).replace(/^[=+\-@]/, "'$&").slice(0, 3000);
const pick_ = (o, ks) => { const r = {}; ks.forEach(k => r[k] = o[k]); return r; };
const csv_ = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
let _S = null;
function S_(k) { if (!_S) { _S = {}; all_('Settings').forEach(r => _S[r.key] = r.value); } return _S[k] === undefined ? '' : String(_S[k]); }
function all_(n) {
  const sh = ss_().getSheetByName(n); if (!sh) return []; const v = sh.getDataRange().getValues(), h = v.shift();
  return v.map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i]); return o; });
}
function add_(n, o) {
  const sh = ss_().getSheetByName(n), h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (h.indexOf('id') >= 0 && !o.id) o.id = uid_(); if (h.indexOf('created') >= 0) o.created = new Date();
  sh.appendRow(h.map(k => o[k] === undefined ? '' : o[k])); return o;
}
function set_(n, id, patch, key) {
  key = key || 'id'; const sh = ss_().getSheetByName(n), v = sh.getDataRange().getValues(), h = v[0], ki = h.indexOf(key);
  for (let i = 1; i < v.length; i++) if (String(v[i][ki]) === String(id)) { Object.keys(patch).forEach(k => { const c = h.indexOf(k); if (c >= 0) sh.getRange(i + 1, c + 1).setValue(patch[k]); }); return true; }
  return false;
}
const one_ = (n, f) => all_(n).find(f);
const audit_ = (u, action, detail) => add_('Audit', {user_id: u ? u.id : '', action, detail: String(detail || '').slice(0, 300)});
const notify_ = (uid, text, link) => { if (uid) add_('Notifications', {user_id: uid, text, link: link || '', read: false}); };
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
function limit_(key, max, secs) { const c = CacheService.getScriptCache(), n = Number(c.get(key) || 0); if (n >= max) fail_('Too many attempts. Please try again later.'); c.put(key, String(n + 1), secs || 900); }
const need_ = (b, ks) => ks.forEach(k => { if (!String(b[k] || '').trim()) fail_('Missing field: ' + k); });
const email_ = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || fail_('Invalid email address');

// ---------- email (queued, quota-aware, editable templates) ----------
function mail_(to, tpl, vars) {
  const t = one_('Templates', r => r.key === tpl); if (!t || !to) return;
  const v = Object.assign({support_email: S_('support_email'), whatsapp: S_('whatsapp')}, vars || {}), fill = s => String(s).replace(/\{\{(\w+)\}\}/g, (_, k) => v[k] === undefined ? '' : v[k]);
  sendOne_(add_('Outbox', {to, subject: fill(t.subject), body: fill(t.body), status: 'queued', attempts: 0}));
}
function sendOne_(o) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) return; const name = S_('sender_name') || 'Indian Aeronautics', from = S_('sender_email');
    try { GmailApp.sendEmail(o.to, o.subject, o.body, {name, from, replyTo: S_('support_email')}); } catch (e) { MailApp.sendEmail({to: o.to, subject: o.subject, body: o.body, name, replyTo: S_('support_email')}); }
    set_('Outbox', o.id, {status: 'sent'});
  } catch (e) { const n = Number(o.attempts || 0) + 1; set_('Outbox', o.id, {attempts: n, error: String(e).slice(0, 100), status: n >= 5 ? 'failed' : 'queued'}); }
}
function processOutbox() { all_('Outbox').filter(r => r.status === 'queued').slice(0, 40).forEach(sendOne_); }   // time trigger: drains mail queued past the daily quota
const adminMail_ = (subj, body) => { const a = S_('admin_email'); if (a) { add_('Outbox', {to: a, subject: '[IA] ' + subj, body: body, status: 'queued', attempts: 0}); } };

// ---------- auth ----------
function hash_(pw, salt) { let d = salt + pw; for (let i = 0; i < 400; i++) d = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, d + salt)); return d; }
const roles_ = u => csv_(u.roles);
const isAdmin_ = u => !!u && roles_(u).indexOf('admin') >= 0;
const pubUser_ = u => ({id: u.id, name: u.name, email: u.email, role: isAdmin_(u) ? 'admin' : (roles_(u)[0] || 'buyer'), roles: roles_(u), company_id: u.company_id, company_role: u.company_role, google: !!u.google_sub});
function session_(u) { const token = Utilities.getUuid() + Utilities.getUuid(); add_('Sessions', {token, user_id: u.id, exp: Date.now() + 7 * 864e5}); return token; }
function userByToken_(t) {
  const s = one_('Sessions', r => r.token === t && Number(r.exp) > Date.now()); if (!s) return null;
  return one_('Users', r => r.id === s.user_id && r.status === 'Active') || null;
}
function sendCode_(u, purpose) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  set_('Users', u.id, {code: hash_(code, u.id), code_exp: Date.now() + 15 * 60e3});
  mail_(u.email, purpose === 'verify' ? 'email_verification' : 'password_reset', {name: u.name, code}); return code;
}
const codeOk_ = (u, c) => u.code && Number(u.code_exp) > Date.now() && u.code === hash_(String(c).trim(), u.id);
const dev_ = code => T_(S_('dev_show_codes')) ? {dev_code: code} : {};
const ACCOUNT_TYPES = ['buyer','supplier','professional','trainer','student','mro','employer','company_rep','company_admin'];
const byEmail_ = e => one_('Users', r => String(r.email).toLowerCase() === String(e).toLowerCase());

// ---------- public GET ----------
const PUB = {
  Companies: ['id','verification','name','type','industry','category','capabilities','products','services','materials','certifications','city','state','country','website','export','size','description','owner_id'],
  RFQs: ['id','created','rfq_no','title','quantity','material','process','certification','location','delivery_date'],
  Jobs: ['id','created','title','company','city','state','type','description','apply_email'],
  Courses: ['id','title','description','category','trainer_name','duration','mode','curriculum','price','certificate','start_date'],
};
const LIVE = ['Approved','Published','Matching','Responses Received','Shortlisted','Negotiation'];
function doGet(e) {
  const a = String(e.parameter.action || '').toLowerCase(), q = String(e.parameter.q || '').toLowerCase(), pg = Math.max(1, parseInt(e.parameter.page) || 1), lim = Math.min(100, parseInt(e.parameter.limit) || 50);
  try {
    if (a === 'health') return json_({ok: true});
    if (a === 'settings') return json_({ok: true, data: {support_email: S_('support_email'), whatsapp: S_('whatsapp'), platform_name: S_('platform_name'), google_client_id: S_('google_client_id')}});
    if (a === 'stats') return json_({ok: true, companies: all_('Companies').filter(r => r.status === 'Approved').length, rfqs: all_('RFQs').filter(r => LIVE.indexOf(r.status) >= 0 && r.visibility === 'Public').length, jobs: all_('Jobs').filter(r => r.status === 'Approved').length});
    if (a === 'plans') return json_({ok: true, data: all_('Plans').filter(p => T_(p.active)).map(p => pick_(p, ['id','name','price_inr','duration_days','features','tax_pct']))});
    const sheet = {companies: 'Companies', mro: 'Companies', jobs: 'Jobs', rfqs: 'RFQs', courses: 'Courses'}[a]; if (!sheet) return json_({ok: false, error: 'Unknown action'});
    let list = all_(sheet).filter(r => sheet === 'RFQs' ? (LIVE.indexOf(r.status) >= 0 && r.visibility === 'Public') : r.status === 'Approved' && !r.merged_into);
    if (a === 'mro') list = list.filter(r => /mro/i.test([r.type, r.industry, r.category].join(' ')));
    if (q) list = list.filter(r => JSON.stringify(pick_(r, PUB[sheet])).toLowerCase().indexOf(q) >= 0);
    ['industry','state','type','category'].forEach(f => { if (e.parameter[f]) list = list.filter(r => String(r[f]).toLowerCase() === String(e.parameter[f]).toLowerCase()); });
    return json_({ok: true, total: list.length, page: pg, data: list.slice((pg - 1) * lim, pg * lim).map(r => pick_(r, PUB[sheet]))});
  } catch (err) { logErr_('GET ' + a, err); return json_({ok: false, error: 'Something went wrong. Please try again or contact ' + S_('support_email')}); }
}

// ---------- POST router ----------
const OPEN = ['register','verify','resend','login','forgot','reset','google_login','contact','company','rfq','job','enquiry','view'];
const ADMIN_ONLY = /^(admin_|import_|export|merge_|claim_review|payment_confirm|refund_done|file_scan|settings_|templates_|backup_now|payout_|enrol_pay|enrol_refund)/;
function logErr_(action, err) { try { add_('Errors', {action, message: String(err && err.message || err).slice(0, 300)}); } catch (e) {} }
function doPost(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000); let act = '';
  try {
    const b = JSON.parse(e.postData.contents); act = String(b.action || ''); _S = null;
    if (b.website_url_hp) return json_({ok: true});
    const H = handlers_(), fn = H[act]; if (!fn || !Object.prototype.hasOwnProperty.call(H, act)) return json_({ok: false, error: 'Unknown action'});
    const u = b.token ? userByToken_(b.token) : null;
    if (OPEN.indexOf(act) < 0 && !u) return json_({ok: false, error: 'Please log in', auth: true});
    if (ADMIN_ONLY.test(act) && !isAdmin_(u)) return json_({ok: false, error: 'Admin only'});
    const res = fn(b, u) || {}; res.ok = true; return json_(res);
  } catch (err) {
    if (err && err.user) return json_({ok: false, error: err.message});
    logErr_(act, err); return json_({ok: false, error: 'Something went wrong. Please try again or contact ' + S_('support_email')});
  } finally { lock.releaseLock(); }
}
const handlers_ = () => Object.assign({}, authH_(), companyH_(), marketH_(), moneyH_(), adminH_());

function authH_() { return {
  register(b) {
    need_(b, ['name','email','password','role']); email_(b.email); const em = b.email.toLowerCase().trim(); limit_('reg' + em, 5);
    if (ACCOUNT_TYPES.indexOf(b.role) < 0) fail_('Invalid account type'); if (String(b.password).length < 8 || !/[A-Za-z]/.test(b.password) || !/\d/.test(b.password)) fail_('Password must be 8+ characters with a letter and a number');
    let u = byEmail_(em), code; const msg = 'If this email can be registered, a verification code has been sent.';
    if (!u) { const id = uid_(); u = add_('Users', {id, email: em, name: clean_(b.name).slice(0, 100), phone: clean_(b.phone).slice(0, 20), roles: b.role, status: 'Unverified', salt: id, hash: hash_(b.password, id), marketing: 'FALSE'}); code = sendCode_(u, 'verify'); }
    else if (u.status === 'Unverified') code = sendCode_(u, 'verify');
    return Object.assign({message: msg}, code ? dev_(code) : {});
  },
  resend(b) { email_(b.email); limit_('rs' + b.email, 4); const u = byEmail_(b.email); let c; if (u && u.status === 'Unverified') c = sendCode_(u, 'verify'); return Object.assign({message: 'If the account needs verification, a new code was sent.'}, c ? dev_(c) : {}); },
  verify(b) {
    limit_('v' + b.email, 6); const u = byEmail_(b.email || '');
    if (!u || !codeOk_(u, b.code)) fail_('Invalid or expired code'); set_('Users', u.id, {status: 'Active', code: '', code_exp: ''}); audit_(u, 'verify_email'); return {token: session_(u), user: pubUser_(u)};
  },
  login(b) {
    limit_('l' + b.email, 8); const u = byEmail_(b.email || '');
    if (!u || !u.hash || u.hash !== hash_(String(b.password), u.salt)) fail_('Wrong email or password');
    if (u.status === 'Unverified') fail_('Verify your email first. Use “Resend code” if you need a new one.'); if (u.status !== 'Active') fail_('Account suspended. Contact ' + S_('support_email'));
    audit_(u, 'login'); return {token: session_(u), user: pubUser_(u)};
  },
  google_login(b) {   // official Google Identity Services ID token, verified with Google's tokeninfo endpoint
    limit_('g' + String(b.credential).slice(-12), 10); if (!S_('google_client_id')) fail_('Google sign-in is not configured yet');
    const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(b.credential), {muteHttpExceptions: true}); if (r.getResponseCode() !== 200) fail_('Google sign-in failed');
    const p = JSON.parse(r.getContentText()); if (p.aud !== S_('google_client_id') || String(p.email_verified) !== 'true' || !p.email) fail_('Google sign-in failed');
    let u = one_('Users', x => x.google_sub === p.sub);
    if (!u) { u = byEmail_(p.email);
      if (u) { if (u.status !== 'Active') fail_('Verify your existing account by email first, then link Google.'); set_('Users', u.id, {google_sub: p.sub}); u.google_sub = p.sub; }   // link only to a verified account with the same email
      else { const id = uid_(), role = ACCOUNT_TYPES.indexOf(b.role) >= 0 ? b.role : 'buyer'; u = add_('Users', {id, email: p.email.toLowerCase(), name: clean_(p.name || p.email), roles: role, status: 'Active', google_sub: p.sub, marketing: 'FALSE'}); } }
    if (u.status !== 'Active') fail_('Account suspended'); audit_(u, 'login_google'); return {token: session_(u), user: pubUser_(u)};
  },
  google_disconnect(b, u) { if (!u.hash) fail_('Set a password first (use Forgot password) so you can still log in.'); set_('Users', u.id, {google_sub: ''}); },
  logout(b) { set_('Sessions', b.token, {exp: 0}, 'token'); },
  forgot(b) { email_(b.email); limit_('f' + b.email, 4); const u = byEmail_(b.email); let c; if (u && u.status !== 'Suspended') c = sendCode_(u, 'reset'); return Object.assign({message: 'If the account exists, a reset code was sent.'}, c ? dev_(c) : {}); },
  reset(b) {
    limit_('r' + b.email, 6); const u = byEmail_(b.email || ''); if (!u || !codeOk_(u, b.code) || String(b.password).length < 8 || !/[A-Za-z]/.test(b.password) || !/\d/.test(b.password)) fail_('Invalid code or weak password');
    set_('Users', u.id, {hash: hash_(b.password, u.salt), code: '', code_exp: '', status: 'Active'}); all_('Sessions').filter(s => s.user_id === u.id).forEach(s => set_('Sessions', s.token, {exp: 0}, 'token')); return {message: 'Password updated. Log in.'};
  },
  me: (b, u) => ({user: pubUser_(u), plan: pick_(planOf_(u), ['id','name','features'])}),
  profile_save(b, u) { set_('Users', u.id, {name: clean_(b.name || u.name).slice(0, 100), phone: clean_(b.phone).slice(0, 20), marketing: T_(b.marketing) ? 'TRUE' : 'FALSE'}); return {user: pubUser_(one_('Users', r => r.id === u.id))}; },
  roles_add(b, u) { if (ACCOUNT_TYPES.indexOf(b.role) < 0) fail_('Invalid account type'); const rs = roles_(u); if (rs.indexOf(b.role) < 0) rs.push(b.role); set_('Users', u.id, {roles: rs.join(',')}); return {user: pubUser_(one_('Users', r => r.id === u.id))}; },
  account_delete(b, u) { add_('Tickets', {status: 'Open', name: u.name, email: u.email, subject: 'Account deletion request', message: 'User requested deletion of account ' + u.id, user_id: u.id}); adminMail_('Deletion request', u.email); return {message: 'Request received. We will confirm by email within 30 days.'}; },
  my_data(b, u) { return {profile: pick_(u, ['id','email','name','phone','roles','created','marketing']), company_id: u.company_id, rfqs: all_('RFQs').filter(r => r.owner_id === u.id).length, messages: all_('Messages').filter(m => m.from_id === u.id || m.to_id === u.id).length}; },
}; }
