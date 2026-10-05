const $ = s => document.querySelector(s), V = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let me = null, plan = null;
const call = (a, d) => IA_API.call(a, d).then(r => { if (r.auth) { me = null; nav(); if (!location.hash.startsWith('#/login')) location.hash = '#/login'; } return r; });
const pub = (a, p) => IA_API.pub(a, p);
const adminExtra = {};
const fld = (n, l, o = {}) => `<label>${esc(l)}${o.opts ? `<select name="${n}">${o.opts.map(x => `<option ${Array.isArray(x) ? `value="${esc(x[0])}">${esc(x[1])}` : `>${esc(x)}`}</option>`).join('')}</select>` : o.area ? `<textarea name="${n}" rows="3"></textarea>` : `<input name="${n}" type="${o.t || 'text'}" ${o.req ? 'required' : ''} ${o.v ? `value="${esc(o.v)}"` : ''}>`}</label>`;
const form = (a, inner, btn = 'Save', pre = '') => `<form class="form w" data-a="${a}" ${pre}>${inner}<input class="hp" name="website_url_hp" tabindex="-1" autocomplete="off"><button class="btn primary">${btn}</button><p class="msg" role="status"></p></form>`;
const table = (cols, rows) => `<div class="scroll"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${cols.length}">Nothing here yet.</td></tr>`}</tbody></table></div>`;
const date = s => s ? new Date(s).toLocaleDateString('en-IN') : '';
const rupee = n => '₹' + Number(n).toLocaleString('en-IN');
const readB64 = f => new Promise(r => { const x = new FileReader(); x.onload = () => r(x.result.split(',')[1]); x.readAsDataURL(f); });
async function uploadFiles(input, rfq) { const ids = []; for (const f of input.files) { if (f.size > 5 * 1048576) throw new Error(f.name + ' is over 5 MB'); const r = await call('upload', {name: f.name, data: await readB64(f), rfq_id: rfq || ''}); if (!r.ok) throw new Error(r.error); ids.push(r.id); } return ids.join(','); }
async function getFile(id) { const r = await call('download', {id}); if (!r.ok) return alert(r.error); const a = document.createElement('a'); a.href = 'data:application/octet-stream;base64,' + r.data; a.download = r.name; a.click(); }

function nav() {
  $('#authNav').innerHTML = me ? `<a href="#/dashboard">${esc(me.name)}</a> · <a href="#" id="out">Log out</a>` : '<a href="#/login">Log in</a> · <a href="#/register">Create account</a>';
  const p = $('#pnav'); p.hidden = !me;
  if (me) { const r = me.role; p.innerHTML = ['<a href="#/dashboard">Dashboard</a>', r === 'buyer' || r === 'admin' ? '<a href="#/rfq/new">Post an RFQ</a><a href="#/saved">Saved suppliers</a>' : '', ['supplier','mro','company_rep','trainer'].includes(r) ? '<a href="#/company">My company</a>' : '', ['supplier','mro','company_rep'].includes(r) ? '<a href="#/feed">RFQ opportunities</a>' : '', r === 'trainer' ? '<a href="#/course/new">Submit course</a><a href="#/students">Students</a>' : '', '<a href="#/inbox">Messages</a><a href="#/notes">Notifications</a><a href="#/billing">Billing</a>', r === 'admin' ? '<a href="#/admin">Admin</a>' : ''].join(''); }
}
document.addEventListener('click', async e => { if (e.target.id === 'out') { e.preventDefault(); await call('logout'); me = null; nav(); location.hash = '#/login'; } });

const views = {
  login: () => `<h2>Log in</h2>${form('login', fld('email','Email',{t:'email',req:1}) + fld('password','Password',{t:'password',req:1}), 'Log in')}<p><a href="#/forgot">Forgot password</a> · <a href="#/register">Create account</a></p>`,
  register: () => `<h2>Create your account</h2>${form('register', fld('role','I am a…',{opts:[['buyer','Buyer'],['supplier','Supplier'],['professional','Aerospace professional'],['trainer','Training provider'],['mro','MRO provider'],['company_rep','Company representative']]}) + fld('name','Full name',{req:1}) + fld('email','Email',{t:'email',req:1}) + fld('phone','Phone') + fld('password','Password (8+ characters)',{t:'password',req:1}), 'Create account')}`,
  verify: p => `<h2>Verify your email</h2>${sessionStorage.getItem('ia_dev_code') ? `<p class="card ai"><strong>Test mode:</strong> your code is <code>${esc(sessionStorage.getItem('ia_dev_code'))}</code> (shown only while the admin setting dev_show_codes is on).</p>` : ''}${form('verify', fld('email','Email',{t:'email',v:p[0] ? decodeURIComponent(p[0]) : '',req:1}) + fld('code','6-digit code',{req:1}), 'Verify')}<p><button class="btn ghost sm" id="resend" data-email="${esc(p[0] ? decodeURIComponent(p[0]) : '')}">Resend code</button></p>`,
  forgot: () => `<h2>Reset password</h2>${form('forgot', fld('email','Email',{t:'email',req:1}), 'Send code')}<p><a href="#/reset">I have a code</a></p>`,
  reset: () => `<h2>Set a new password</h2>${form('reset', fld('email','Email',{t:'email',req:1}) + fld('code','Code',{req:1}) + fld('password','New password',{t:'password',req:1}), 'Update password')}`,

  async dashboard() {
    const d = await call('dashboard'); if (!d.ok) return `<p class="msg err">${esc(d.error)}</p>`;
    const k = (n, l) => `<div><b>${n ?? 0}</b>${l}</div>`;
    const co = d.company, claimHint = !co && ['supplier','mro','company_rep'].includes(d.role) ? '<p class="card">Set up your company: <a href="#/company">create a profile</a> or find it in the <a href="index.html#companies">directory</a> and press “Claim this company”.</p>' : '';
    return `<h2>Dashboard</h2><p class="meta">${esc(d.role)} · plan: ${esc(d.plan)} · <a href="#/plans">upgrade</a></p>${claimHint}
    ${co ? `<p><strong>${esc(co.name)}</strong> <span class="badge ${co.verification !== 'Basic Profile' ? 'ok' : ''}">${esc(co.verification)}</span> <span class="badge">${esc(co.status)}</span></p><p class="meta">Profile completion ${co.completion}%</p><div class="bar"><i style="width:${co.completion}%"></i></div>` : ''}
    <div class="kpi">${k(d.rfqs.length,'My RFQs')}${co ? k(d.rfq_opps,'RFQ opportunities') + k(d.quotes_sent,'Quotations sent') + k(d.enquiries,'Enquiries') + (d.views !== undefined ? k(d.views,'Profile views') : '') : ''}${k(d.saved,'Saved suppliers')}${k(d.unread,'Unread messages')}</div>
    <h3>My RFQs</h3>${table(['RFQ','Title','Status','Matched','Responses','Date'], d.rfqs.map(r => `<tr><td><a href="#/rfq/${r.id}">${esc(r.rfq_no)}</a></td><td>${esc(r.title)}</td><td>${esc(r.status)}</td><td>${r.matched}</td><td>${r.responses}</td><td>${date(r.created)}</td></tr>`))}`;
  },
  async company() {
    const r = await call('company_get'), c = r.company || {}, v = k => ({v: c[k] || ''});
    return `<h2>My company</h2>${c.id ? `<p class="meta">Status: ${esc(c.status)} · ${esc(c.verification)}. Certifications you enter are shown as self-declared until Indian Aeronautics checks documents.</p>` : ''}${form('company_save', fld('name','Company name',{...v('name'),req:1}) + fld('type','Type',{opts:['Manufacturer','Supplier','MRO','Engineering services','Technology','Training']}) + fld('industry','Industry',{opts:['Aviation','Aerospace Manufacturing','Space','Defence','UAV / Drone','MRO','Engineering','Electronics']}) + ['description','website','email','phone','country','state','city','address','capabilities','products','services','materials','certifications','contact_person','size','founded','export'].map(k => fld(k, k.replace('_',' '), v(k))).join(''), 'Save company')}`;
  },
  claim: p => `<h2>Claim this company</h2><p>Is this your company? Tell us how we can confirm it.</p>${form('claim_submit', `<input type="hidden" name="company_id" value="${esc(p[0])}">` + fld('designation','Your designation',{req:1}) + fld('company_email','Company email',{t:'email',req:1}) + fld('phone','Phone',{req:1}) + fld('info','Verification information (e.g. company page, GST-linked contact – optional)',{area:1}), 'Submit claim')}`,

  'rfq-new': () => `<h2>Post an RFQ</h2>${form('rfq_create', fld('title','Requirement title',{req:1}) + fld('description','Description',{area:1}) + fld('category','Category') + fld('quantity','Quantity',{req:1}) + fld('unit','Unit') + fld('material','Material') + fld('process','Manufacturing process') + fld('certification','Required certification',{opts:['Not required','Required']}) + fld('location','Delivery location') + fld('delivery_date','Required delivery date',{t:'date'}) + fld('budget','Budget (optional)') + fld('visibility','Visibility',{opts:['Public','Registered suppliers','Verified suppliers','Invite-only','Private']}) + '<label>Attachments (PDF, Office, image, ZIP; max 5 MB each; stored privately)<input type="file" name="files" multiple></label><label><input type="checkbox" name="publish" checked style="width:auto"> Publish now (untick to save as draft)</label>', 'Submit RFQ')}`,
  async rfq(p) {
    const r = await call('rfq_get', {id: p[0]}); if (!r.ok) return `<p class="msg err">${esc(r.error)}</p>`; const x = r.rfq, files = String(x.file_ids || '').split(',').filter(Boolean);
    let h = `<h2>${esc(x.rfq_no)} — ${esc(x.title)}</h2><p class="meta">${esc(x.status)} · visibility: ${esc(x.visibility)}</p><p>${esc(x.description)}</p><p>Qty ${esc(x.quantity)} ${esc(x.unit)} · ${esc(x.material)} · ${esc(x.process)} · Certification: ${esc(x.certification)} · ${esc(x.location)} · by ${esc(x.delivery_date)}</p>${files.map(f => `<button class="btn ghost sm" data-file="${f}">Download file</button> `).join('')}`;
    if (r.owner) {
      h += `<p><label>Status <select id="st">${['Draft','Published','Matching','Responses Received','Shortlisted','Negotiation','Closed','Cancelled'].map(s => `<option ${s === x.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label> <button class="btn ghost sm" id="stb" data-id="${x.id}">Update status</button> <button class="btn primary sm" id="mt" data-id="${x.id}">Find potentially relevant suppliers</button></p><div id="matches"></div>
      <h3>Quotations received</h3><p class="meta">The buyer decides. Nothing here is ranked or labelled “best”.</p>${table(['Supplier','Price','Lead time','MOQ','Terms','Status','Actions'], r.quotes.map(q => `<tr><td>${esc(q.company_name)}</td><td>${esc(q.currency)} ${esc(q.price)}</td><td>${esc(q.lead_time)}</td><td>${esc(q.moq)}</td><td>${esc(q.terms)} ${esc(q.comments)}</td><td>${esc(q.status)}</td><td>${['Shortlisted','Preferred','Clarification Requested','Rejected'].map(s => `<button class="btn ghost sm" data-q="${q.id}" data-s="${s}">${s === 'Clarification Requested' ? 'Clarify' : s}</button>`).join(' ')} <a class="btn ghost sm" href="#/chat/${q.user_id}">Message</a></td></tr>`))}`;
    } else h += `<h3>Submit quotation</h3>${r.quotes.length ? '<p class="meta">You have already responded.</p>' : ''}${form('quote_submit', `<input type="hidden" name="rfq_id" value="${x.id}">` + fld('price','Price',{req:1}) + fld('currency','Currency',{opts:['INR','USD','EUR']}) + fld('moq','MOQ') + fld('lead_time','Lead time',{req:1}) + fld('terms','Delivery terms') + fld('validity','Validity') + fld('comments','Technical comments',{area:1}) + '<label>Attachments<input type="file" name="files" multiple></label>', 'Submit quotation')} <a href="#/chat/${x.owner_id}">Message buyer</a>`;
    return h;
  },
  async feed() { const r = await call('rfq_feed'); return `<h2>RFQ opportunities</h2><p class="meta">RFQs matching your access level. Responding needs the Professional plan or higher.</p>${table(['RFQ','Title','Qty','Material','Process','Location'], (r.data || []).map(x => `<tr><td><a href="#/rfq/${x.id}">${esc(x.rfq_no)}</a></td><td>${esc(x.title)}</td><td>${esc(x.quantity)}</td><td>${esc(x.material)}</td><td>${esc(x.process)}</td><td>${esc(x.location)}</td></tr>`))}`; },
  async saved() { const r = await call('saved'); return `<h2>Saved suppliers</h2>${table(['Company','Location','Type',''], (r.data || []).map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.city)}</td><td>${esc(c.type)}</td><td>${c.owner_id ? `<a href="#/chat/${c.owner_id}">Message</a>` : ''}</td></tr>`))}`; },

  async inbox() { const r = await call('msg_inbox'); return `<h2>Messages</h2>${table(['With','Last message','Unread'], (r.data || []).map(t => `<tr><td><a href="#/chat/${t.with}">${esc(t.name)}</a></td><td>${esc(t.last)}</td><td>${t.unread}</td></tr>`))}`; },
  async chat(p) {
    const r = await call('msg_thread', {with: p[0]}); if (!r.ok) return `<p class="msg err">${esc(r.error)}</p>`;
    return `<h2>${esc(r.with.name)}</h2><div class="chat">${r.data.map(m => `<div class="b ${m.mine ? 'me' : ''}">${esc(m.body)} ${String(m.file_ids || '').split(',').filter(Boolean).map(f => `<button class="btn ghost sm" data-file="${f}">File</button>`).join('')}<div class="meta">${new Date(m.at).toLocaleString('en-IN')}</div></div>`).join('')}</div>
    ${form('msg_send', `<input type="hidden" name="to_id" value="${esc(p[0])}">` + fld('body','Message',{area:1}) + '<label>Attachment<input type="file" name="files" multiple></label>', 'Send')}<p><button class="btn ghost sm" id="rep" data-w="${esc(p[0])}">Report this user</button></p>`;
  },
  async notes() { const r = await call('notes'); call('notes_read'); return `<h2>Notifications</h2>${table(['When','Notification'], (r.data || []).map(n => `<tr><td>${date(n.created)}</td><td>${esc(n.text)}</td></tr>`))}`; },

  async plans() {
    const r = await pub('plans');
    return `<h2>Plans</h2><div class="grid">${(r.data || []).map(p => {
      const courseUrl = p.id === 'professional'
        ? 'https://www.buye.online/courses/907313?utm_source%3Dother%26utm_medium%3Dtutor-course-referral%26utm_campaign%3Dcourse-overview-webapp'
        : p.id === 'business'
          ? 'https://www.buye.online/courses/907324?utm_source%3Dother%26utm_medium%3Dtutor-course-referral%26utm_campaign%3Dcourse-overview-webapp'
          : '';

      const button = p.id === 'enterprise'
        ? `<button class="btn primary sm" data-plan="${p.id}">Contact us</button>`
        : courseUrl
          ? `<button class="btn primary sm" onclick="window.location.href='${courseUrl}'">Choose</button>`
          : `<button class="btn primary sm" data-free-plan="free">Choose</button>`;

      return `<article class="card"><h3>${esc(p.name)}</h3><p><strong>${p.id === 'enterprise' ? 'Custom pricing' : Number(p.price_inr) ? rupee(p.price_inr) + ' / ' + Math.round(p.duration_days / 365) + ' yr + ' + (p.tax_pct || 0) + '% GST' : '₹0'}</strong></p><p class="meta">${esc(String(p.features).replace(/_/g, ' ').split(',').join(', '))}</p>${button}</article>`;
    }).join('') || '<p class="empty">Plans appear once the backend is connected.</p>'}</div>`;
  },
  async billing() {
    const r = await call('payments_mine'); return `<h2>Billing</h2>${table(['Date','Ref','Plan','Amount','Status','Invoice',''], (r.data || []).map(p => `<tr><td>${date(p.created)}</td><td>${esc(p.ref)}</td><td>${esc(p.plan_id)}</td><td>${rupee(p.amount)}</td><td>${esc(p.status)}</td><td>${esc(p.invoice_no)}</td><td>${p.status === 'Paid' ? `<button class="btn ghost sm" data-refund="${p.id}">Request refund</button>` : ''}</td></tr>`))}<h3>Subscriptions</h3>${table(['Plan','Status','Ends'], (r.subs || []).map(s => `<tr><td>${esc(s.plan_id)}</td><td>${esc(s.status)}</td><td>${date(s.end)}</td></tr>`))}<p><button class="btn ghost sm" id="cancelSub">Cancel subscription</button> · <a href="legal.html#refund">Refund policy</a></p>`;
  },

  async academy() {
    const r = await pub('courses'); return `<h2>Indian Aeronautics Academy</h2><div class="grid">${(r.data || []).map(c => `<article class="card"><span class="badge">${esc(c.category)}</span><h3>${esc(c.title)}</h3><p class="meta">${esc(c.trainer_name)} · ${esc(c.duration)} · ${esc(c.mode)} · ${c.price ? rupee(c.price) : 'Free'}${c.start_date ? ' · starts ' + esc(c.start_date) : ''}</p><p>${esc(c.description)}</p><p class="meta">Certificate: ${esc(c.certificate || 'Not stated')}</p><button class="btn primary sm" data-enrol="${c.id}">Enrol</button></article>`).join('') || '<p class="empty">No approved courses yet. Training providers can register and submit courses.</p>'}</div>`;
  },
  'course-new': () => `<h2>Submit a course</h2>${form('course_submit', fld('title','Title',{req:1}) + fld('category','Category',{opts:['Aviation','Aerospace','MRO','UAV/Drone','Space','Manufacturing','Avionics','Aerospace Software','Safety','Supply Chain']}) + fld('description','Description',{area:1,req:1}) + fld('duration','Duration') + fld('mode','Mode',{opts:['Live online','Recorded','In person','Hybrid']}) + fld('curriculum','Curriculum',{area:1}) + fld('price','Price (₹, blank = free)') + fld('certificate','Certificate details') + fld('start_date','Start date',{t:'date'}), 'Submit for approval')}`,
  async students() { const r = await call('trainer_students'); return `<h2>Students</h2>${table(['Course','Student','Status'], (r.data || []).map(s => `<tr><td>${esc(s.course)}</td><td>${esc(s.student)}</td><td>${esc(s.status)}</td></tr>`))}`; },
  async mro() {
    const r = await pub('mro'); return `<h2>Aerospace MRO Network</h2><p class="meta">Aircraft, engine, component and avionics MRO, inspection and NDT providers. Listings are self-declared unless a verification badge is shown. Providers: <a href="#/register">create an MRO account</a>.</p><div class="grid">${(r.data || []).map(c => `<article class="card"><span class="badge ${c.verification !== 'Basic Profile' ? 'ok' : ''}">${esc(c.verification)}</span><h3>${esc(c.name)}</h3><p class="meta">${esc(c.city)}${c.state ? ', ' + esc(c.state) : ''}</p><p>${esc(c.capabilities || c.services)}</p>${c.owner_id ? `<a class="btn primary sm" href="#/chat/${c.owner_id}">Send enquiry</a>` : `<a href="#/claim/${c.id}">Claim this company</a>`}</article>`).join('') || '<p class="empty">No approved MRO providers yet.</p>'}</div>`;
  },

  async admin(p) {
    const tab = p[0] || 'import', tabs = ['analytics','import','export','merge','Companies','Claims','Payments','Courses','Jobs','RFQs','Users','files','payouts','Tickets','settings','templates','Outbox','Imports','Merges','Audit','Errors'];
    let h = `<h2>Admin</h2><div class="tabs">${tabs.map(t => `<a class="btn ghost sm" href="#/admin/${t}">${t}</a>`).join('')}</div>`;
    if (adminExtra[tab]) return h + await adminExtra[tab]();
    if (tab === 'import') return h + `<h3>Import companies (CSV / XLSX)</h3><p class="meta">Existing records are never overwritten. Possible duplicates are shown for you to merge, skip or create separately.</p><input type="file" id="impFile" accept=".csv,.xlsx,.xls"><div id="imp"></div>`;
    if (tab === 'export') return h + `<h3>Export (secrets and password data are never included)</h3><label>What<select id="expKind">${['companies','verified','suppliers','mro','training','users','rfqs','leads'].map(k => `<option>${k}</option>`).join('')}</select></label> <button class="btn primary" data-exp="xlsx">Download XLSX</button> <button class="btn ghost" data-exp="csv">Download CSV</button>`;
    const r = await call('admin_list', {sheet: tab}); if (!r.ok) return h + esc(r.error);
    const act = x => tab === 'Claims' ? `<button class="btn ghost sm" data-claim="${x.id}" data-d="Approved">Approve</button> <button class="btn ghost sm" data-claim="${x.id}" data-d="Rejected">Reject</button>` : tab === 'Payments' ? (x.status === 'Pending' ? `<button class="btn primary sm" data-pay="${x.id}">Mark paid</button>` : x.status === 'Refund Requested' ? `<button class="btn ghost sm" data-refunded="${x.id}">Mark refunded</button>` : '') : ['Companies','Courses','Jobs','RFQs'].includes(tab) ? `<button class="btn ghost sm" data-set="${tab}|${x.id}|Approved">Approve</button> <button class="btn ghost sm" data-set="${tab}|${x.id}|Rejected">Reject</button>${tab === 'Companies' ? ` <select data-ver="${x.id}"><option>Basic Profile</option><option>Documents Submitted</option><option>Profile Verified</option><option>Capability Verified</option></select>` : ''}` : tab === 'Users' ? `<button class="btn ghost sm" data-set="Users|${x.id}|Suspended">Suspend</button> <button class="btn ghost sm" data-set="Users|${x.id}|Active">Activate</button> <button class="btn ghost sm" data-role="${x.id}">Make admin</button>` : '';
    const cols = {Companies:['name','city','email','status','verification'], Claims:['company_id','user_id','designation','company_email','status'], Payments:['ref','user_id','plan_id','amount','status'], Courses:['title','trainer_name','status'], Jobs:['title','company','status'], RFQs:['rfq_no','title','visibility','status'], Users:['name','email','role','status'], Audit:['created','user_id','action','detail']}[tab] || Object.keys(r.data[0] || {}).slice(0, 7);
    return h + table([...cols, ''], r.data.map(x => `<tr>${cols.map(c => `<td>${esc(x[c])}</td>`).join('')}<td>${act(x)}</td></tr>`));
  },
};

async function route() {
  const [name, ...p] = (location.hash.replace(/^#\//, '') || (me ? 'dashboard' : 'login')).split('/');
  const key = name === 'rfq' && p[0] === 'new' ? 'rfq-new' : name === 'course' ? 'course-new' : name;
  const open = ['login','register','verify','forgot','reset','academy','mro','plans'];
  if (!me && IA_API.hasToken()) { const r = await call('me'); if (r.ok) { me = r.user; plan = r.plan; } }
  nav(); if (!me && !open.includes(key)) { location.hash = '#/login'; return; }
  V.innerHTML = '<p class="meta">Loading…</p>'; V.innerHTML = views[key] ? await views[key](key === 'rfq' || key === 'course' ? (p[0] === 'new' ? [] : p) : p) : '<p>Page not found.</p>'; wire();
}
addEventListener('hashchange', route); addEventListener('DOMContentLoaded', route);

// forms: attach files first, then call the action
document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-a]'); if (!f) return; e.preventDefault();
  const a = f.dataset.a, msg = f.querySelector('.msg'), btn = f.querySelector('button.primary'), d = {};
  new FormData(f).forEach((v, k) => { if (!(v instanceof File)) d[k] = v; }); d.publish = f.querySelector('[name=publish]') ? f.querySelector('[name=publish]').checked : undefined;
  btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Working…';
  try { const fi = f.querySelector('input[type=file]'); if (fi && fi.files.length) d.file_ids = await uploadFiles(fi); } catch (er) { msg.className = 'msg err'; msg.textContent = er.message; btn.disabled = false; return; }
  const r = await call(a, d); btn.disabled = false;
  if (!r.ok) { msg.className = 'msg err'; msg.textContent = r.error; return; }
  msg.className = 'msg good'; msg.textContent = r.message || 'Saved.';
  if (r.token) { me = r.user; location.hash = '#/dashboard'; route(); }
  else if (a === 'register') { if (r.dev_code) sessionStorage.setItem('ia_dev_code', r.dev_code); else sessionStorage.removeItem('ia_dev_code'); location.hash = '#/verify/' + encodeURIComponent(d.email); }
  else if (a === 'reset') location.hash = '#/login';
  else if (a === 'forgot') location.hash = '#/reset';
  else if (a === 'rfq_create') location.hash = '#/rfq/' + r.id;
  else if (['msg_send','quote_submit','team_invite','job_post','profile_save','roles_add','payout_create','discussion_post'].includes(a)) { if (a === 'profile_save' || a === 'roles_add') { const m = await call('me'); if (m.ok) { me = m.user; } } route(); }
});

const loadScript = src => new Promise((ok, no) => { if ([...document.scripts].some(x => x.src === src)) return ok(); const x = document.createElement('script'); x.src = src; x.onload = ok; x.onerror = no; document.head.appendChild(x); });
function wire() {
  const rs = $('#resend'); if (rs) rs.onclick = async () => { const r = await call('resend', {email: rs.dataset.email || (document.querySelector('[name=email]') || {}).value}); if (r.dev_code) sessionStorage.setItem('ia_dev_code', r.dev_code); alert(r.ok ? r.message : r.error); };
  V.querySelectorAll('[data-file]').forEach(b => b.onclick = () => getFile(b.dataset.file));
  V.querySelectorAll('[data-q]').forEach(b => b.onclick = async () => { const r = await call('quote_status', {id: b.dataset.q, status: b.dataset.s}); r.ok ? route() : alert(r.error); });
  const stb = $('#stb'); if (stb) stb.onclick = async () => { const r = await call('rfq_status', {id: stb.dataset.id, status: $('#st').value}); r.ok ? route() : alert(r.error); };
  const mt = $('#mt'); if (mt) mt.onclick = async () => { $('#matches').textContent = 'Matching…'; const r = await call('rfq_match', {id: mt.dataset.id}); $('#matches').innerHTML = !r.ok ? esc(r.error) : `<p class="meta"><strong>AI-assisted recommendations</strong> built only from supplier-listed data, not verified facts. Review before contacting. Detected: ${esc([...r.extracted.processes, ...r.extracted.materials, r.extracted.machine].filter(Boolean).join(', ') || 'nothing specific')}.</p><div class="grid">${r.matches.map(m => `<article class="card ai"><h3>${esc(m.company.name)}</h3><p class="meta">${esc(m.company.city)} · ${esc(m.company.verification)}</p><strong>Why this company matched</strong><ul>${m.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>${m.notes.map(n => `<p class="meta">${esc(n)}</p>`).join('')}${m.company.owner_id ? `<a class="btn ghost sm" href="#/chat/${m.company.owner_id}">Message</a>` : ''}</article>`).join('') || '<p class="empty">No suppliers matched the listed capability data.</p>'}</div>`; };
  V.querySelectorAll('[data-free-plan]').forEach(b => b.onclick = async () => {
    if (!me) { location.hash = '#/login'; return; }
    const r = await call('free_activate', {plan_id: 'free'});
    if (!r.ok) return alert(r.error);
    alert(r.message || 'Free Basic Profile activated successfully.');
    location.hash = '#/dashboard';
  });  V.querySelectorAll('[data-plan]').forEach(b => b.onclick = async () => { if (!me) { location.hash = '#/login'; return; } if (b.dataset.plan === 'enterprise') { location.href = 'mailto:' + IA.email + '?subject=Enterprise%20plan'; return; }
    const r = await call('checkout', {plan_id: b.dataset.plan}); if (!r.ok) return alert(r.error);
    if (r.order_id) { await loadScript('https://checkout.razorpay.com/v1/checkout.js'); new Razorpay({key: r.key_id, amount: Math.round(r.amount * 100), currency: r.currency, order_id: r.order_id, name: 'Indian Aeronautics', description: 'Plan ' + b.dataset.plan, prefill: {name: me.name, email: me.email},
      handler: async x => { const v = await call('payment_verify', {order_id: x.razorpay_order_id, payment_id: x.razorpay_payment_id, signature: x.razorpay_signature}); alert(v.ok ? 'Payment verified. Your plan is ' + v.status + '.' : v.error); route(); }}).open(); return; }
    if (r.link) { alert('You will be taken to the payment page. After paying, an admin confirms it and activates your plan. Quote reference ' + r.ref + '.'); window.open(r.link, '_blank', 'noopener'); } });
  V.querySelectorAll('[data-refund]').forEach(b => b.onclick = async () => { const r = await call('refund_request', {id: b.dataset.refund}); r.ok ? route() : alert(r.error); });
  const cs = $('#cancelSub'); if (cs) cs.onclick = async () => { if (confirm('Cancel your subscription?')) { const r = await call('sub_cancel'); alert(r.message || r.error); route(); } };
  V.querySelectorAll('[data-enrol]').forEach(b => b.onclick = async () => { if (!me) { location.hash = '#/login'; return; } const r = await call('enrol', {course_id: b.dataset.enrol}); alert(r.ok ? 'Enrolment requested. The trainer will contact you.' : r.error); });
  const rep = $('#rep'); if (rep) rep.onclick = async () => { const reason = prompt('What is the problem?'); if (reason) { const r = await call('msg_report', {with: rep.dataset.w, reason}); alert(r.message || r.error); } };
  V.querySelectorAll('[data-claim]').forEach(b => b.onclick = async () => { await call('claim_review', {id: b.dataset.claim, decision: b.dataset.d}); route(); });
  V.querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => { if (confirm('Confirm that this payment was received?')) { const r = await call('payment_confirm', {id: b.dataset.pay}); r.ok ? route() : alert(r.error); } });
  V.querySelectorAll('[data-set]').forEach(b => b.onclick = async () => { const [sheet, id, status] = b.dataset.set.split('|'); await call('admin_set', {sheet, id, patch: {status}}); route(); });
  V.querySelectorAll('[data-refunded]').forEach(b => b.onclick = async () => { const r = await call('refund_done', {id: b.dataset.refunded}); r.ok ? route() : alert(r.error); });
  V.querySelectorAll('[data-ver]').forEach(s => s.onchange = async () => { await call('admin_set', {sheet: 'Companies', id: s.dataset.ver, patch: {verification: s.value}}); });
  V.querySelectorAll('[data-role]').forEach(b => b.onclick = async () => { if (confirm('Give this user full admin rights?')) { await call('admin_set', {sheet: 'Users', id: b.dataset.role, patch: {role: 'admin'}}); route(); } });
  V.querySelectorAll('[data-exp]').forEach(b => b.onclick = async () => { const r = await call('export_data', {kind: $('#expKind').value}); if (!r.ok) return alert(r.error); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([r.header, ...r.rows]), 'Companies'); XLSX.writeFile(wb, 'ia-' + $('#expKind').value + '.' + b.dataset.exp, {bookType: b.dataset.exp}); });
  const imp = $('#impFile'); if (imp) imp.onchange = () => importWizard(imp.files[0]);
}

// ---- import wizard: upload → map → validate → preview → confirm → import ----
const TARGETS = {name:'Company Name',description:'Description',website:'Website',email:'Email',phone:'Phone',country:'Country',state:'State',city:'City',industry:'Industry',category:'Category',products:'Products',services:'Services',capabilities:'Capabilities',certifications:'Certifications',address:'Address',contact_person:'Contact Person',size:'Company Size',founded:'Founded Year',export:'Export Capability',verification:'Verification Status'};
const nk = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
async function importWizard(file) {
  const box = $('#imp'); if (!file) return; const wb = XLSX.read(await file.arrayBuffer()), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, defval: ''}), head = rows.shift().map(String), data = rows.filter(r => r.some(c => String(c).trim()));
  const guess = k => head.findIndex(h => nk(h) === nk(TARGETS[k]) || nk(h) === nk(k) || (k === 'contact_person' && /contact/i.test(h)) || (k === 'size' && /size/i.test(h)));
  box.innerHTML = `<h4>Step 2 — Map columns (${data.length} rows)</h4><div class="scroll"><table>${Object.keys(TARGETS).map(k => `<tr><td>${TARGETS[k]} → <code>${k}</code></td><td><select data-map="${k}"><option value="-1">(skip)</option>${head.map((h, i) => `<option value="${i}" ${guess(k) === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></td></tr>`).join('')}</table></div><p><label><input type="checkbox" id="pubNow" style="width:auto"> Publish imported companies immediately (otherwise they stay Pending)</label></p><button class="btn primary" id="val">Validate</button><div id="pv"></div>`;
  $('#val').onclick = async () => {
    const map = {}; box.querySelectorAll('[data-map]').forEach(s => { if (+s.value >= 0) map[s.dataset.map] = +s.value; });
    const objs = data.map(r => { const o = {}; for (const k in map) o[k] = String(r[map[k]]).trim(); return o; }), res = []; $('#pv').textContent = 'Validating…';
    for (let i = 0; i < objs.length; i += 150) { const r = await call('import_check', {rows: objs.slice(i, i + 150)}); if (!r.ok) { $('#pv').textContent = r.error; return; } res.push(...r.data); }
    const bad = res.filter(x => x.errors.length).length, dup = res.filter(x => !x.errors.length && x.dup).length;
    $('#pv').innerHTML = `<h4>Step 4 — Preview</h4><p>${res.length - bad - dup} ready to create · <strong>${dup}</strong> possible duplicates · ${bad} with errors (skipped)</p>` + table(['#','Company','Result','Decision'], res.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.row.name)}</td><td>${x.errors.length ? esc(x.errors.join('; ')) : x.dup ? `<strong>Possible duplicate company found:</strong> ${esc(x.dup.name)} (${esc(x.dup.city)}, ${esc(x.dup.email)})` : 'New'}</td><td>${x.errors.length ? 'Skip' : x.dup ? `<select data-dec="${i}"><option value="skip">Skip</option><option value="merge">Merge (fill empty fields)</option><option value="create">Create separate record</option></select>` : 'Create'}</td></tr>`)) + '<button class="btn primary" id="go">Step 5 — Confirm import</button><p class="msg" id="impMsg"></p>';
    $('#go').onclick = async () => {
      $('#go').disabled = true; let t = {made: 0, merged: 0, skipped: 0};
      for (let i = 0; i < res.length; i += 100) { const chunk = res.slice(i, i + 100).map((x, j) => ({row: x.row, decision: (document.querySelector(`[data-dec="${i + j}"]`) || {}).value || 'create'})); const r = await call('import_commit', {rows: chunk, publish: $('#pubNow').checked, file: file.name}); if (!r.ok) { $('#impMsg').textContent = r.error; return; } t.made += r.made; t.merged += r.merged; t.skipped += r.skipped; $('#impMsg').textContent = 'Importing… ' + Math.min(i + 100, res.length) + '/' + res.length; }
      $('#impMsg').textContent = `Done: ${t.made} created, ${t.merged} merged, ${t.skipped} skipped.`;
    };
  };
}










