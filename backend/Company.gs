// Companies, teams, claims, merge, import/export, jobs, leads
const can_ = (role, p) => (PERMS[role] || []).indexOf(p) >= 0;
function needPerm_(u, p) { if (isAdmin_(u)) return; if (!u.company_id || !can_(u.company_role, p)) fail_('Not allowed for your role in this company'); }
const completion_ = c => { const f = ['description','website','email','phone','capabilities','products','materials','certifications','city','contact_person','size','export']; return Math.round(100 * f.filter(k => String(c[k] || '').trim()).length / f.length); };
const norm_ = s => String(s || '').toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|inc|the)\b/g, '').replace(/[^a-z0-9]/g, '');
const host_ = s => String(s || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
const has_ = v => v !== null && v !== undefined && String(v).trim() !== '';
const sameVal_ = (a, b) => host_(String(a).trim().toLowerCase()) === host_(String(b).trim().toLowerCase());

// Merge rule: never overwrite populated data. Fill only empty existing fields; both populated and different = conflict the admin must resolve.
function previewMerge_(ex, du, choices) {
  choices = choices || {}; const final = Object.assign({}, ex), changes = [], conflicts = [], retained = [];
  FIELDS.forEach(f => { const e = ex[f], d = du[f];
    if (!has_(e) && has_(d)) { final[f] = d; changes.push({field: f, from: has_(e) ? e : '', to: d, why: 'filled empty'}); }
    else if (has_(e) && has_(d) && !sameVal_(e, d)) {
      if (choices[f] === 'duplicate') { final[f] = d; changes.push({field: f, from: e, to: d, why: 'admin chose duplicate'}); }
      else { conflicts.push({field: f, existing: e, duplicate: d, resolved: choices[f] === 'existing'}); retained.push(f); } }
    else if (has_(e)) retained.push(f); });
  return {final, changes, conflicts, retained, needsDecision: conflicts.some(c => !c.resolved)};
}
function checkRow_(r, ex) {
  const errors = []; if (!has_(r.name)) errors.push('Company name missing'); if (!has_(r.email)) errors.push('Email missing'); else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) errors.push('Invalid email');
  if (r.website && !/^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/.*)?$/i.test(r.website)) errors.push('Invalid URL'); const ph = String(r.phone || '').replace(/\D/g, '').slice(-10);
  const dup = ex.find(c => !c.merged_into && ((norm_(r.name) && norm_(c.name) === norm_(r.name)) || (r.website && host_(c.website) === host_(r.website)) || (r.email && String(c.email).toLowerCase() === String(r.email).toLowerCase()) || (ph.length === 10 && String(c.phone).replace(/\D/g, '').slice(-10) === ph)));
  return {errors, dup: dup ? pick_(dup, ['id','name','website','email','phone','city']) : null, row: r};
}
const setCompany_ = (uid, cid, role) => set_('Users', uid, {company_id: cid, company_role: role});
const coOf_ = u => u.company_id ? one_('Companies', c => c.id === u.company_id) : null;

function companyH_() { return {
  company_get: (b, u) => { const c = coOf_(u); return {company: c ? Object.assign({}, c, {completion: completion_(c)}) : null, company_role: u.company_role}; },
  company_save(b, u) {
    if (!isAdmin_(u) && ['supplier','mro','company_rep','company_admin','trainer','employer'].filter(r => roles_(u).indexOf(r) >= 0).length === 0) fail_('Your account type cannot own a company');
    const p = {}; FIELDS.forEach(k => { if (b[k] !== undefined) p[k] = clean_(b[k]); }); const c = coOf_(u);
    if (c) { needPerm_(u, 'company.manage'); set_('Companies', c.id, p); return {id: c.id}; }
    need_(b, ['name']); const n = add_('Companies', Object.assign(p, {status: 'Pending', verification: 'Basic Profile', owner_id: u.id, views: 0})); setCompany_(u.id, n.id, 'owner'); adminMail_('New company', n.name); return {id: n.id};
  },
  claim_submit(b, u) {
    need_(b, ['company_id','designation','company_email','phone']); email_(b.company_email); if (!one_('Companies', c => c.id === b.company_id)) fail_('Company not found');
    if (one_('Claims', r => r.company_id === b.company_id && r.user_id === u.id && r.status === 'Pending')) fail_('You already have a pending claim');
    add_('Claims', {status: 'Pending', company_id: b.company_id, user_id: u.id, designation: clean_(b.designation), company_email: clean_(b.company_email), phone: clean_(b.phone), info: clean_(b.info)}); adminMail_('Company claim', 'Review the Claims sheet'); return {message: 'Claim submitted. Admin will review it.'};
  },
  claim_review(b, u) {
    const c = one_('Claims', r => r.id === b.id), ok = b.decision === 'Approved'; if (!c) fail_('Not found'); const co = one_('Companies', x => x.id === c.company_id), us = one_('Users', x => x.id === c.user_id);
    set_('Claims', c.id, {status: ok ? 'Approved' : 'Rejected'}); if (ok) { set_('Companies', c.company_id, {owner_id: c.user_id}); setCompany_(c.user_id, c.company_id, 'owner'); }
    notify_(c.user_id, ok ? 'Company Profile Claimed — you can now manage it.' : 'Your company claim was not approved.'); mail_(us && us.email, 'claim_result', {name: us && us.name, company: co && co.name, result: ok ? 'approved' : 'not approved'}); audit_(u, 'claim_' + b.decision, c.id);
  },
  view(b) { const c = one_('Companies', x => x.id === b.id && x.status === 'Approved'); if (!c) return; set_('Companies', c.id, {views: Number(c.views || 0) + 1}); const d = new Date().toISOString().slice(0, 10), v = one_('Views', x => x.company_id === c.id && String(x.date).slice(0, 10) === d); if (v) set_('Views', v.id, {count: Number(v.count) + 1}); else add_('Views', {date: d, company_id: c.id, count: 1}); },

  // --- team ---
  team_list(b, u) { needPerm_(u, 'company.view'); return {data: all_('Users').filter(x => x.company_id === u.company_id).map(x => ({id: x.id, name: x.name, role: x.company_role})), invites: all_('Invites').filter(i => i.company_id === u.company_id && i.status === 'Pending').map(i => pick_(i, ['id','email','name','role']))}; },
  team_invite(b, u) {
    needPerm_(u, 'team.manage'); email_(b.email); if (['admin','procurement','sales','hr','engineering','viewer'].indexOf(b.role) < 0) fail_('Invalid role'); limit_('inv' + u.id, 20, 3600);
    const t = Utilities.getUuid() + Utilities.getUuid(), co = coOf_(u); add_('Invites', {company_id: u.company_id, email: b.email.toLowerCase(), name: clean_(b.name), role: b.role, token_hash: hash_(t, 'inv'), exp: Date.now() + 7 * 864e5, status: 'Pending'});
    mail_(b.email, 'company_invitation', {name: b.name || '', company: co.name, role: b.role, link: S_('site_url') + '/portal.html#/accept/' + t}); audit_(u, 'team_invite', b.email + ' ' + b.role); return Object.assign({message: 'Invitation sent.'}, T_(S_('dev_show_codes')) ? {dev_invite_token: t} : {});
  },
  team_accept(b, u) {
    const i = one_('Invites', r => r.status === 'Pending' && r.token_hash === hash_(String(b.invite), 'inv') && Number(r.exp) > Date.now()); if (!i || String(i.email).toLowerCase() !== String(u.email).toLowerCase()) fail_('Invitation invalid, expired or for another email');
    if (u.company_id) fail_('You already belong to a company'); setCompany_(u.id, i.company_id, i.role); set_('Invites', i.id, {status: 'Accepted'}); audit_(u, 'team_accept', i.company_id); return {};
  },
  team_remove(b, u) { needPerm_(u, 'team.manage'); const t = one_('Users', x => x.id === b.user_id && x.company_id === u.company_id); if (!t) fail_('Member not found'); if (t.company_role === 'owner') fail_('The owner cannot be removed'); setCompany_(t.id, '', ''); audit_(u, 'team_remove', t.id); },
  team_role(b, u) { needPerm_(u, 'team.manage'); const t = one_('Users', x => x.id === b.user_id && x.company_id === u.company_id); if (!t || t.company_role === 'owner') fail_('Cannot change this member'); if (['admin','procurement','sales','hr','engineering','viewer'].indexOf(b.role) < 0) fail_('Invalid role'); set_('Users', t.id, {company_role: b.role}); },
  invite_cancel(b, u) { needPerm_(u, 'team.manage'); const i = one_('Invites', r => r.id === b.id && r.company_id === u.company_id); if (i) set_('Invites', i.id, {status: 'Cancelled'}); },

  // --- anonymous legacy forms from the public site (moderated: status Pending) ---
  company(b) { need_(b, ['name','industry','city','email','contact_person']); email_(b.email); limit_('co' + b.email, 3, 3600); const o = {}; FIELDS.forEach(k => o[k] = clean_(b[k])); if (checkRow_(o, all_('Companies')).dup) fail_('A company with this name, email, website or phone is already listed. Use “Claim this company”.');
    const n = add_('Companies', Object.assign(o, {status: 'Pending', verification: 'Basic Profile', views: 0})); adminMail_('New company (public form)', o.name); return {id: n.id}; },
  enquiry(b, u) {
    need_(b, ['company_id','buyer_name','buyer_email','requirement']); email_(b.buyer_email); limit_('enq' + b.buyer_email, 5, 3600); const c = one_('Companies', x => x.id === b.company_id && x.status === 'Approved'); if (!c) fail_('Company not found');
    const l = add_('Leads', {status: 'New', company_id: c.id, buyer_name: clean_(b.buyer_name), buyer_email: clean_(b.buyer_email), buyer_phone: clean_(b.buyer_phone), requirement: clean_(b.requirement)}); if (c.owner_id) notify_(c.owner_id, 'New enquiry from ' + b.buyer_name, '#/leads'); return {id: l.id};
  },

  // --- leads (Sales role) ---
  leads_list(b, u) { needPerm_(u, 'lead.manage'); return {data: all_('Leads').filter(l => l.company_id === u.company_id).reverse()}; },
  lead_update(b, u) { needPerm_(u, 'lead.manage'); const l = one_('Leads', x => x.id === b.id && x.company_id === u.company_id); if (!l) fail_('Lead not found'); const p = {};
    if (b.status !== undefined) { if (['New','Contacted','Qualified','Quotation','Negotiation','Won','Lost'].indexOf(b.status) < 0) fail_('Invalid status'); p.status = b.status; } ['est_value','follow_up','notes'].forEach(k => { if (b[k] !== undefined) p[k] = clean_(b[k]); }); set_('Leads', l.id, p); },

  // --- jobs (HR role) ---
  job_post(b, u) { needPerm_(u, 'job.manage'); need_(b, ['title','apply_email']); email_(b.apply_email); const c = coOf_(u); if (!c) fail_('Create your company profile first'); const j = add_('Jobs', {status: 'Pending', company_id: c.id, title: clean_(b.title), company: c.name, city: clean_(b.city || c.city), state: clean_(b.state), type: clean_(b.type), description: clean_(b.description), apply_email: clean_(b.apply_email)}); adminMail_('Job posted', j.title); return {id: j.id}; },
  jobs_mine(b, u) { needPerm_(u, 'applications.view'); return {data: all_('Jobs').filter(j => j.company_id === u.company_id).map(j => Object.assign(j, {applications: all_('Applications').filter(a => a.job_id === j.id).length}))}; },
  job_apply(b, u) { const j = one_('Jobs', x => x.id === b.job_id && x.status === 'Approved'); if (!j) fail_('Job not found'); if (one_('Applications', a => a.job_id === j.id && a.user_id === u.id)) fail_('You already applied'); add_('Applications', {job_id: j.id, user_id: u.id, name: u.name, message: clean_(b.message), status: 'Received'}); const o = one_('Users', x => x.company_id === j.company_id && x.company_role === 'owner'); notify_(o && o.id, 'New application for ' + j.title, '#/jobs-manage'); },
  applications(b, u) { needPerm_(u, 'applications.view'); const j = one_('Jobs', x => x.id === b.job_id && x.company_id === u.company_id); if (!j) fail_('Job not found'); return {data: all_('Applications').filter(a => a.job_id === j.id).map(a => pick_(a, ['id','created','user_id','name','message','status']))}; },
  application_status(b, u) { needPerm_(u, 'applications.view'); const a = one_('Applications', x => x.id === b.id), j = a && one_('Jobs', x => x.id === a.job_id && x.company_id === u.company_id); if (!j) fail_('Not found'); set_('Applications', a.id, {status: ['Received','Shortlisted','Rejected','Hired'].indexOf(b.status) >= 0 ? b.status : a.status}); notify_(a.user_id, 'Your application for ' + j.title + ': ' + b.status); },

  // --- admin: merge, import, export ---
  merge_preview(b) { const ex = one_('Companies', c => c.id === b.existing_id && !c.merged_into), du = one_('Companies', c => c.id === b.duplicate_id && !c.merged_into); if (!ex || !du || ex.id === du.id) fail_('Pick two different companies'); return previewMerge_(ex, du, b.choices); },
  merge_confirm(b, u) {
    const ex = one_('Companies', c => c.id === b.existing_id && !c.merged_into), du = one_('Companies', c => c.id === b.duplicate_id && !c.merged_into); if (!ex || !du || ex.id === du.id) fail_('Pick two different companies');
    const pv = previewMerge_(ex, du, b.choices); if (pv.needsDecision) fail_('Resolve every conflict first (keep existing or use duplicate)'); const prev = {}, p = {}; pv.changes.forEach(x => { prev[x.field] = x.from; p[x.field] = x.to; });
    if (Object.keys(p).length) set_('Companies', ex.id, p); set_('Companies', du.id, {status: 'Merged', merged_into: ex.id});
    all_('Users').filter(x => x.company_id === du.id).forEach(x => setCompany_(x.id, ex.id, x.company_role)); all_('RFQs').filter(x => x.company_id === du.id).forEach(x => set_('RFQs', x.id, {company_id: ex.id})); all_('Quotes').filter(x => x.company_id === du.id).forEach(x => set_('Quotes', x.id, {company_id: ex.id}));
    const m = add_('Merges', {admin_id: u.id, existing_id: ex.id, duplicate_id: du.id, changes: JSON.stringify(pv.changes), previous: JSON.stringify(prev), undone: 'FALSE'}); audit_(u, 'company_merge', m.id); return {merge_id: m.id, changes: pv.changes};
  },
  merge_undo(b, u) { const m = one_('Merges', r => r.id === b.merge_id && !T_(r.undone)); if (!m) fail_('Nothing to undo'); set_('Companies', m.existing_id, JSON.parse(m.previous)); set_('Companies', m.duplicate_id, {status: 'Pending', merged_into: ''}); set_('Merges', m.id, {undone: 'TRUE'}); audit_(u, 'merge_undo', m.id); return {note: 'Field values restored. Moved RFQs, quotes and team members stay with the surviving company.'}; },
  import_check(b) { const ex = all_('Companies'); return {data: (b.rows || []).slice(0, 150).map(r => checkRow_(r, ex))}; },
  import_commit(b, u) {
    const ex = all_('Companies'), st = b.publish ? 'Approved' : 'Pending'; let made = 0, merged = 0, skipped = 0, errs = 0;
    (b.rows || []).slice(0, 100).forEach(x => { const r = x.row, chk = checkRow_(r, ex); if (chk.errors.length) { errs++; skipped++; return; } if (x.decision === 'skip') { skipped++; return; }
      if (chk.dup && x.decision === 'merge') { const full = ex.find(c => c.id === chk.dup.id), pv = previewMerge_(full, r, {}), p = {}; pv.changes.forEach(c => p[c.field] = c.to); if (Object.keys(p).length) set_('Companies', full.id, p); merged++; return; }
      if (chk.dup && x.decision !== 'create') { skipped++; return; }
      const o = {}; FIELDS.forEach(k => o[k] = clean_(r[k])); o.status = st; o.views = 0; o.verification = ['Basic Profile','Profile Verified','Documents Submitted','Capability Verified'].indexOf(r.verification) >= 0 ? r.verification : 'Basic Profile'; ex.push(add_('Companies', o)); made++; });
    add_('Imports', {admin_id: u.id, file: clean_(b.file || ''), made, merged, skipped, errors: errs}); audit_(u, 'import', made + ' new, ' + merged + ' merged, ' + skipped + ' skipped'); return {made, merged, skipped, errors: errs};
  },
  export_data(b, u) {
    const kind = b.kind, C = all_('Companies').filter(c => !c.merged_into); let sheet = 'Companies', rows, hdr;
    const strip = ['salt','hash','code','code_exp','token_hash','google_sub'];
    if (kind === 'companies') rows = C; else if (kind === 'verified') rows = C.filter(c => c.verification && c.verification !== 'Basic Profile'); else if (kind === 'suppliers') rows = C.filter(c => /supplier|manufactur/i.test(c.type)); else if (kind === 'mro') rows = C.filter(c => /mro/i.test([c.type, c.industry].join(' '))); else if (kind === 'training') rows = C.filter(c => /training/i.test(c.type));
    else if (kind === 'users') { sheet = 'Users'; rows = all_('Users'); } else if (kind === 'rfqs') { sheet = 'RFQs'; rows = all_('RFQs'); } else if (kind === 'leads') { sheet = 'Leads'; rows = all_('Leads'); } else fail_('Unknown export');
    hdr = SCHEMA[sheet].filter(h => strip.indexOf(h) < 0); audit_(u, 'export', kind); return {header: hdr, rows: rows.map(r => hdr.map(h => r[h]))};
  },
}; }
