// Admin tools, contact form, setup, backups
const ADMIN_SHEETS = ['Companies','Users','Claims','RFQs','Quotes','Jobs','Courses','Enrolments','Payments','Subscriptions','Leads','Files','Payouts','Tickets','Outbox','Merges','Imports','Audit','Errors','Invites'];
const SECRET_COLS = ['salt','hash','code','code_exp','token_hash','google_sub'];
const SET_ALLOWED = ['Companies','RFQs','Jobs','Courses','Users','Leads','Tickets','Plans','Payments'];

function adminH_() { return {
  admin_list(b) { if (ADMIN_SHEETS.indexOf(b.sheet) < 0) fail_('Bad sheet'); return {data: all_(b.sheet).map(r => { SECRET_COLS.forEach(k => delete r[k]); return r; }).slice(-300).reverse()}; },
  admin_set(b, u) {
    if (SET_ALLOWED.indexOf(b.sheet) < 0) fail_('Bad sheet'); const p = {}; Object.keys(b.patch || {}).forEach(k => { if (SECRET_COLS.concat(['id']).indexOf(k) < 0) p[k] = clean_(b.patch[k]); });
    if (b.sheet === 'Users' && p.status && ['Active','Suspended','Unverified'].indexOf(p.status) < 0) fail_('Invalid status'); set_(b.sheet, b.id, p); audit_(u, 'admin_set ' + b.sheet, b.id + ' ' + JSON.stringify(p));
  },
  settings_get: () => ({data: SETTINGS_EDITABLE.map(k => ({key: k, value: S_(k)})), last_backup: S_('last_backup'), email_quota: MailApp.getRemainingDailyQuota(), queued_mail: all_('Outbox').filter(o => o.status === 'queued').length, failed_mail: all_('Outbox').filter(o => o.status === 'failed').length, errors_24h: all_('Errors').filter(e => Date.now() - new Date(e.created).getTime() < 864e5).length}),
  settings_set(b, u) { if (SETTINGS_EDITABLE.indexOf(b.key) < 0) fail_('Setting not editable'); if (!set_('Settings', b.key, {value: clean_(b.value)}, 'key')) add_('Settings', {key: b.key, value: clean_(b.value)}); _S = null; audit_(u, 'setting', b.key); },
  templates_get: () => ({data: all_('Templates')}),
  templates_set(b, u) { need_(b, ['key','subject','body']); if (!set_('Templates', b.key, {subject: String(b.subject).slice(0, 200), body: String(b.body).slice(0, 5000)}, 'key')) fail_('Template not found'); audit_(u, 'template', b.key); },
  backup_now(b, u) { backup_(); return {last_backup: S_('last_backup')}; },
  contact(b) {
    need_(b, ['name','email','subject','message']); email_(b.email); limit_('ct' + b.email, 3, 3600); const t = add_('Tickets', {status: 'Open', name: clean_(b.name).slice(0, 100), email: clean_(b.email), company: clean_(b.company).slice(0, 100), subject: clean_(b.subject).slice(0, 150), message: clean_(b.message).slice(0, 3000)});
    mail_(b.email, 'contact_ack', {name: b.name, ref: t.id}); adminMail_('Contact: ' + t.subject, t.name + ' <' + t.email + '>\n\n' + t.message); return {ref: t.id};
  },
}; }

function backup_() {   // weekly trigger: copies the spreadsheet into the same single Drive folder, keeps the 8 most recent copies
  const fol = folder_(), stamp = new Date().toISOString().slice(0, 16).replace('T', ' '), files = [];
  DriveApp.getFileById(ss_().getId()).makeCopy('IA Backup ' + stamp, fol); const fi = fol.getFiles(); while (fi.hasNext()) { const f = fi.next(); if (/^IA Backup /.test(f.getName())) files.push(f); }
  files.sort((a, c) => c.getDateCreated() - a.getDateCreated()); files.slice(8).forEach(f => f.setTrashed(true));
  if (!set_('Settings', 'last_backup', {value: stamp}, 'key')) add_('Settings', {key: 'last_backup', value: stamp}); _S = null;
}
function setup() {   // idempotent: adds missing sheets/columns only, never touches existing rows
  Object.keys(SCHEMA).forEach(n => { const sh = ss_().getSheetByName(n) || ss_().insertSheet(n), have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [], miss = SCHEMA[n].filter(h => have.indexOf(h) < 0);
    if (miss.length) sh.getRange(1, have.length + 1, 1, miss.length).setValues([miss]); sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#0f2a4f').setFontColor('#ffffff'); sh.setFrozenRows(1); });
  const pl = ss_().getSheetByName('Plans'); if (pl.getLastRow() < 2) pl.getRange(2, 1, PLAN_SEED.length, 9).setValues(PLAN_SEED);
  const have = all_('Settings').map(r => r.key); SETTINGS_DEFAULT.forEach(r => { if (have.indexOf(r[0]) < 0) add_('Settings', {key: r[0], value: r[1]}); });
  const tk = all_('Templates').map(r => r.key); TEMPLATE_SEED.forEach(r => { if (tk.indexOf(r[0]) < 0) add_('Templates', {key: r[0], subject: r[1], body: r[2]}); });
  folder_(); _S = null;
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t)); ScriptApp.newTrigger('processOutbox').timeBased().everyMinutes(10).create(); ScriptApp.newTrigger('backup_').timeBased().everyWeeks(1).create();
  const d = ss_().getSheetByName('Sheet1'); if (d && ss_().getSheets().length > 1 && d.getLastRow() === 0) ss_().deleteSheet(d);
}
