const {JSDOM} = require('jsdom'), fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), {test} = require('node:test');
const {createEnv} = require('./mock'), FE = path.join(__dirname, '../frontend');
const env = createEnv({props: {RZP_KEY_ID: 'k', RZP_KEY_SECRET: 's'}, fetch: () => ({code: 404, text: '{}'})});
env.set_('Settings', 'dev_show_codes', {value: 'TRUE'}, 'key');
async function boot(hash = '#/login') {
  const html = fs.readFileSync(path.join(FE, 'portal.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, '');
  const dom = new JSDOM(html, {url: 'http://localhost/portal.html' + hash, runScripts: 'dangerously', pretendToBeVisual: true}), w = dom.window, errors = [];
  w.fetch = async (url, o = {}) => { const u = new URL(url); const body = o.method === 'POST' ? env.doPost({postData: {contents: o.body}}).text : env.doGet({parameter: Object.fromEntries(u.searchParams)}).text; return {json: async () => JSON.parse(body)}; };
  w.alert = m => { w.__alerts = (w.__alerts || []).concat(String(m)); }; w.confirm = () => true; w.prompt = () => 'x'; w.HTMLDialogElement.prototype.showModal = function () {}; w.XLSX = {};
  w.addEventListener('error', e => errors.push(e.message)); const origErr = w.console.error; w.console.error = (...a) => errors.push(a.join(' '));
  const run = code => { const sc = w.document.createElement('script'); sc.textContent = code; w.document.body.appendChild(sc); };   // real classic <script> semantics: shared global lexical scope
  run(fs.readFileSync(path.join(FE, 'config.js'), 'utf8').replace('PASTE_APPS_SCRIPT_WEB_APP_URL_HERE', 'https://script.google.com/macros/s/TEST/exec'));
  for (const f of ['js/api.js', 'portal.js', 'portal2.js']) run(fs.readFileSync(path.join(FE, f), 'utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded')); await wait(30); return {w, errors};
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function go(ctx, hash) { ctx.w.location.hash = hash; await wait(60); await ctx.w.document.dispatchEvent(new ctx.w.Event('x')) || ctx.w.dispatchEvent(new ctx.w.HashChangeEvent('hashchange')); await wait(40); return ctx.w.document.querySelector('#view').innerHTML; }
const bad = h => /undefined|\[object|NaN|Page not found|Loading…/.test(h);
let n = 0;
const reg = (role, tag = 'ui') => { const email = `${tag}${++n}@t.example`, r = env.post(null, 'register', {name: 'UI ' + tag, email, password: 'Passw0rd!x', role}), v = env.post(null, 'verify', {email, code: r.dev_code}); return {email, id: v.user.id, token: v.token}; };

test('login/register UI: form submit logs in and shows the dashboard', async () => {
  const u = reg('supplier', 'form'), c = await boot('#/login'); const d = c.w.document;
  assert.ok(d.querySelector('form[data-a=login]')); d.querySelector('[name=email]').value = u.email; d.querySelector('[name=password]').value = 'Passw0rd!x';
  d.querySelector('form[data-a=login]').dispatchEvent(new c.w.Event('submit', {bubbles: true, cancelable: true})); await wait(250); assert.match(c.w.location.hash, /dashboard/); await wait(100);
  assert.match(d.querySelector('#view').innerHTML, /Dashboard/); assert.match(d.querySelector('#authNav').innerHTML, /Log out/); assert.deepEqual(c.errors, []);
});
test('register UI → verify screen (test-mode code) → verified session', async () => {
  const c = await boot('#/register'), d = c.w.document, email = 'reg_ui@t.example'; d.querySelector('[name=role]').value = 'buyer'; d.querySelector('[name=name]').value = 'Reg UI'; d.querySelector('[name=email]').value = email; d.querySelector('[name=password]').value = 'Passw0rd!x';
  d.querySelector('form[data-a=register]').dispatchEvent(new c.w.Event('submit', {bubbles: true, cancelable: true})); await wait(300); assert.match(c.w.location.hash, /verify/); await wait(80);
  const html = d.querySelector('#view').innerHTML; const code = html.match(/<code>(\d{6})<\/code>/)[1]; d.querySelector('[name=code]').value = code; d.querySelector('form[data-a=verify]').dispatchEvent(new c.w.Event('submit', {bubbles: true, cancelable: true})); await wait(300);
  assert.match(c.w.location.hash, /dashboard/); assert.deepEqual(c.errors, []);
});
test('every screen renders for every role without errors or broken values', async () => {
  const adminU = reg('buyer', 'adm'); env.set_('Users', adminU.id, {roles: 'admin'});
  const owner = reg('supplier', 'own'); env.post(owner.token, 'company_save', {name: 'UI Aero', city: 'Chennai', industry: 'Aerospace Manufacturing', capabilities: '5-axis CNC', email: 'x@ui.example'}); const co = env.post(owner.token, 'company_get').company.id; env.set_('Companies', co, {status: 'Approved', verification: 'Profile Verified'});
  const rfq = env.post(reg('buyer', 'by').token, 'rfq_create', {title: 'UI bracket', quantity: '5', visibility: 'Public', material: 'Aluminium', process: '5-axis CNC'});
  const tr = reg('trainer', 'tr'); env.post(tr.token, 'course_submit', {title: 'UI Course', description: 'd', price: '500'}); env.set_('Courses', env.all_('Courses')[0].id, {status: 'Approved'}); const st = reg('student', 'st'); env.post(st.token, 'enrol', {course_id: env.all_('Courses')[0].id});
  const routes = {owner: ['#/dashboard', '#/company', '#/team', '#/leads', '#/jobs-manage', '#/feed', '#/analytics', '#/account', '#/inbox', '#/notes', '#/billing', '#/plans', '#/academy', '#/mro', '#/saved', '#/rfq/new', '#/rfq/' + rfq.id, '#/claim/' + co],
    trainer: ['#/dashboard', '#/earnings', '#/students', '#/course/new', '#/account'], student: ['#/learning', '#/dashboard', '#/classroom/' + env.all_('Courses')[0].id],
    admin: ['#/admin/analytics', '#/admin/import', '#/admin/export', '#/admin/merge', '#/admin/Companies', '#/admin/Claims', '#/admin/Payments', '#/admin/Courses', '#/admin/Jobs', '#/admin/RFQs', '#/admin/Users', '#/admin/files', '#/admin/payouts', '#/admin/Tickets', '#/admin/settings', '#/admin/templates', '#/admin/Outbox', '#/admin/Imports', '#/admin/Merges', '#/admin/Audit', '#/admin/Errors']};
  const who = {owner, trainer: tr, student: st, admin: adminU};
  for (const [k, list] of Object.entries(routes)) { const c = await boot('#/login'); c.w.sessionStorage.setItem('ia_t', who[k].token); await go(c, '#/dashboard');
    for (const h of list) { const html = await go(c, h); assert.ok(!bad(html), `${k} ${h}: ${html.slice(0, 160).replace(/\s+/g, ' ')}`); } assert.deepEqual(c.errors, [], k + ' ' + c.errors.join('|')); }
});
test('merge UI: compare → conflicts → preview → confirm (spec example)', async () => {
  const a = reg('buyer', 'mg'); env.set_('Users', a.id, {roles: 'admin'}); const ex = env.add_('Companies', {name: 'ABC Aerospace', email: 'info@abc.com', phone: '', website: 'abc.com', city: 'Chennai', status: 'Approved'}).id, du = env.add_('Companies', {name: 'ABC Aerospace Pvt Ltd', phone: '+91 9999999999', website: 'abc.com', status: 'Approved'}).id;
  const c = await boot('#/login'); c.w.sessionStorage.setItem('ia_t', a.token); await go(c, '#/admin/merge'); const d = c.w.document; assert.match(d.querySelector('#view').innerHTML, /Possible duplicates found/);
  d.querySelector('#mEx').value = ex; d.querySelector('#mDu').value = du; d.querySelector('#mPrev').click(); await wait(200); let html = d.querySelector('#view').innerHTML;
  assert.match(html, /Side by side/); assert.match(html, /EMPTY → <strong>\+91 9999999999/); assert.match(html, /Choose keep-existing/); d.querySelector('[data-mc=name][value=existing]').checked = true; d.querySelector('#mPrev2').click(); await wait(200);
  assert.ok(d.querySelector('#mGo'), 'confirm button appears once conflicts resolved'); d.querySelector('#mGo').click(); await wait(300); assert.match(d.querySelector('#mMsg').innerHTML, /Merged/); const r = env.all_('Companies').find(x => x.id === ex); assert.equal(r.name, 'ABC Aerospace'); assert.equal(r.phone, '+91 9999999999'); assert.equal(r.email, 'info@abc.com'); assert.deepEqual(c.errors, []);
});
test('team + Google button + dashboard charts render safely with no data', async () => {
  const c = await boot('#/login'); assert.ok(c.w.document.querySelector('#gbtn')); const u = reg('buyer', 'ch'); c.w.sessionStorage.setItem('ia_t', u.token); const h = await go(c, '#/dashboard'); assert.match(h, /Not enough data yet/); assert.match(h, /wa\.me\/919995863184/);
  assert.match(c.w.document.querySelector('footer').innerHTML, /info@buye\.online/); assert.deepEqual(c.errors, []);
});
