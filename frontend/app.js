// After deploying the Apps Script as a Web app, paste its /exec URL here:
const API_URL = (window.IA && window.IA.api) || 'PASTE';

const INDUSTRIES = ['Aviation','Aerospace Manufacturing','Space','Defence','UAV / Drone','MRO','Engineering','Electronics'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ready = () => /^https:\/\/script\.google(usercontent)?\.com\//.test(API_URL);

async function api(params) {
  if (!ready()) return {ok:false, error:'Backend not connected yet.'};
  try { return await (await fetch(API_URL + '?' + new URLSearchParams(params))).json(); }
  catch { return {ok:false, error:'Network error'}; }
}
const empty = (el, text) => { el.innerHTML = `<p class="empty">${esc(text)}</p>`; };

async function loadCompanies() {
  const el = $('#companyList');
  const res = await api({action: 'companies', q: $('#q').value.trim(), industry: $('#fIndustry').value, state: $('#fState').value.trim(), limit: 50});
  if (!res.ok || !res.data.length) return empty(el, ready() ? 'No approved companies match yet. List your company free to be among the first.' : 'Connect the backend (see README) to show companies.');
  el.innerHTML = res.data.map(c => `<article class="card">
    <span class="badge ${c.verification !== 'Basic Profile' ? 'ok' : ''}">${esc(c.verification)}</span>
    <h3>${esc(c.name)}</h3><p class="meta">${esc(c.type)} · ${esc(c.city)}${c.state ? ', ' + esc(c.state) : ''}</p>
    <p>${esc(c.capabilities || c.products)}</p>
    ${c.certifications ? `<p class="meta">Certifications (self-declared): ${esc(c.certifications)}</p>` : ''}
    <button class="btn primary" data-enq="${esc(c.id)}" data-name="${esc(c.name)}">Request quote</button>
    ${c.owner_id ? '' : `<p class="meta"><a href="portal.html#/claim/${esc(c.id)}">Is this your company? Claim this company</a></p>`}</article>`).join('');
}
async function loadRfqs() {
  const el = $('#rfqList'), res = await api({action:'rfqs'});
  el.innerHTML = (!res.ok || !res.data.length) ? '' : '<h3>Open public RFQs</h3>' + res.data.slice(0,5).map(r => `<div class="card"><strong>${esc(r.title)}</strong><p class="meta">Qty ${esc(r.quantity)} · ${esc(r.material)} · ${esc(r.process)}</p></div>`).join('');
}
async function loadJobs() {
  const el = $('#jobList'), res = await api({action:'jobs'});
  if (!res.ok || !res.data.length) return empty(el, 'No jobs posted yet.');
  el.innerHTML = res.data.map(j => `<article class="card"><h3>${esc(j.title)}</h3><p class="meta">${esc(j.company)} · ${esc(j.city)}</p><p>${esc(j.description)}</p><a class="btn primary" href="mailto:${esc(j.apply_email)}?subject=${encodeURIComponent('Application: ' + j.title)}">Apply</a></article>`).join('');
}
async function loadStats() {
  const s = await api({action:'stats'});
  if (s.ok) $('#stats').textContent = `${s.companies} companies · ${s.rfqs} RFQs · ${s.jobs} jobs`;
}

document.addEventListener('submit', async e => {
  const f = e.target.closest('form.form'); if (!f) return;
  e.preventDefault();
  const msg = f.querySelector('.msg'), btn = f.querySelector('button.primary');
  if (!ready()) { msg.className = 'msg err'; msg.textContent = 'Backend not connected yet. See README.'; return; }
  btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Sending…';
  try {
    const body = Object.fromEntries(new FormData(f)); body.action = f.dataset.action;
    // text/plain avoids a CORS preflight, which Apps Script does not handle
    const r = await (await fetch(API_URL, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(body)})).json();
    if (r.ok) { msg.className = 'msg good'; msg.textContent = 'Received. Reference ' + (r.id || '') + '. Every submission is reviewed before it goes live.'; f.reset(); }
    else { msg.className = 'msg err'; msg.textContent = r.error || 'Could not submit.'; }
  } catch { msg.className = 'msg err'; msg.textContent = 'Network error. Please try again.'; }
  btn.disabled = false;
});

const chips = $('#chips'), sel = $('#fIndustry'), sel2 = $('#fIndustry2');
INDUSTRIES.forEach(i => {
  chips.insertAdjacentHTML('beforeend', `<button class="chip" aria-pressed="false">${i}</button>`);
  sel.insertAdjacentHTML('beforeend', `<option>${i}</option>`); sel2.insertAdjacentHTML('beforeend', `<option>${i}</option>`);
});
chips.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return;
  const on = b.getAttribute('aria-pressed') === 'true';
  chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed','false'));
  b.setAttribute('aria-pressed', String(!on)); sel.value = on ? '' : b.textContent; loadCompanies(); location.hash = '#companies'; });
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); loadCompanies(); location.hash = '#companies'; });
sel.addEventListener('change', loadCompanies);
$('#fState').addEventListener('change', loadCompanies);
document.addEventListener('click', e => { const b = e.target.closest('[data-enq]'); if (b) { $('#enq [name=company_id]').value = b.dataset.enq; $('#enqTitle').textContent = 'Request quote from ' + b.dataset.name; $('#enq').showModal(); } });
$('#enqClose').addEventListener('click', () => $('#enq').close());

loadCompanies(); loadRfqs(); loadJobs(); loadStats();




