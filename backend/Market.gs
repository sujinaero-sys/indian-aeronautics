// RFQs, quotations, matching, messaging, private files, notifications
const RFQ_STATUS = ['Draft','Published','Matching','Responses Received','Shortlisted','Negotiation','Closed','Cancelled'];
const VIS = ['Public','Registered suppliers','Verified suppliers','Invite-only','Private'];
const rfqLive_ = r => ['Published','Matching','Responses Received','Shortlisted','Negotiation','Approved'].indexOf(r.status) >= 0;
function canSee_(u, r) {
  if (isAdmin_(u) || r.owner_id === u.id) return true; if (u.company_id && r.company_id === u.company_id && can_(u.company_role, 'rfq.responses')) return true; if (!rfqLive_(r)) return false;
  const co = coOf_(u), isSup = !!u.company_id || roles_(u).some(x => ['supplier','mro','company_rep','company_admin'].indexOf(x) >= 0);
  switch (r.visibility) { case 'Public': return true; case 'Registered suppliers': return isSup; case 'Verified suppliers': return !!co && co.status === 'Approved' && co.verification && co.verification !== 'Basic Profile'; case 'Invite-only': return !!co && csv_(r.invited).indexOf(co.id) >= 0; default: return false; }
}
const isBuyerSide_ = (u, r) => isAdmin_(u) || r.owner_id === u.id || (u.company_id && r.company_id === u.company_id && can_(u.company_role, 'rfq.responses'));
const PROCS = ['cnc','machining','casting','forging','sheet metal','composite','additive','3d printing','welding','nde','ndt','inspection','testing','assembly','pcb','avionics','mro','overhaul','repair','tooling'];
const MATS = ['aluminium','aluminum','titanium','steel','stainless','inconel','magnesium','carbon fibre','carbon fiber','composite','nickel','copper','plastic'];
function extract_(text) { const t = String(text).toLowerCase(), ax = t.match(/(\d)\s*-?\s*axis/); return {processes: PROCS.filter(p => t.indexOf(p) >= 0), materials: MATS.filter(m => t.indexOf(m) >= 0), machine: ax ? ax[1] + '-axis' : '', aerospace: /aero|aircraft|aviation|space|uav|drone/.test(t)}; }
function match_(r, companies) {   // keyword matching, not an AI model; uses only supplier-listed data
  const q = extract_([r.title, r.description, r.material, r.process, r.category].join(' ')), needCert = /required/i.test(r.certification || '');
  return (companies || all_('Companies').filter(c => c.status === 'Approved' && !c.merged_into)).map(c => {
    const hay = [c.capabilities, c.products, c.services, c.materials, c.category].join(' ').toLowerCase(), why = [];
    q.processes.forEach(p => hay.indexOf(p) >= 0 && why.push('Lists ' + p + ' capability')); q.materials.forEach(m => hay.indexOf(m) >= 0 && why.push('Lists ' + m + ' material')); if (q.machine && hay.indexOf(q.machine) >= 0) why.push('Lists ' + q.machine + ' machining');
    if (q.aerospace && /aero|aviation|space|uav|drone/.test((c.industry + ' ' + hay).toLowerCase())) why.push('Aerospace industry listed'); if (!why.length) return null; const notes = [];
    if (!c.capabilities && !c.materials) notes.push('Capability information not available'); if (needCert) notes.push(c.certifications ? 'Certifications self-declared: ' + c.certifications + ' (not independently verified unless the badge shows)' : 'Certification information not available');
    return {score: why.length, company: pick_(c, ['id','name','city','state','verification','owner_id']), why, notes};
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 20);
}
const rfqOut_ = r => pick_(r, ['id','rfq_no','title','description','category','quantity','unit','material','process','certification','location','delivery_date','budget','status','visibility','file_ids','owner_id','created']);
function notifyMatches_(r) { if (r.visibility === 'Private') return 0; const ms = match_(r); ms.forEach(m => notify_(m.company.owner_id, 'New RFQ matching your capabilities: ' + r.title, '#/rfq/' + r.id)); return ms.length; }

// ---- files ----
const MAGIC = {pdf: [[0x25, 0x50, 0x44, 0x46]], png: [[0x89, 0x50, 0x4E, 0x47]], jpg: [[0xFF, 0xD8, 0xFF]], jpeg: [[0xFF, 0xD8, 0xFF]], zip: [[0x50, 0x4B]], docx: [[0x50, 0x4B]], xlsx: [[0x50, 0x4B]], doc: [[0xD0, 0xCF, 0x11, 0xE0]], xls: [[0xD0, 0xCF, 0x11, 0xE0]]};
function magicOk_(ext, bytes) { if (ext === 'csv') return bytes.slice(0, 2000).every(b => b !== 0); const m = MAGIC[ext]; return !!m && m.some(sig => sig.every((x, i) => (bytes[i] & 255) === x)); }
function folder_() { const it = DriveApp.getFoldersByName('IA_Private_Files'); return it.hasNext() ? it.next() : DriveApp.createFolder('IA_Private_Files'); }
function fileAllowed_(u, f) {
  if (isAdmin_(u) || f.owner_id === u.id) return true;
  const scanOk = f.scan_status === 'clean' || !T_(S_('require_scan_for_sharing')); if (f.scan_status === 'quarantined' || !scanOk) return false; const has = s => csv_(s).indexOf(f.id) >= 0;
  const r = all_('RFQs').find(x => has(x.file_ids)); if (r && (isBuyerSide_(u, r) || (u.company_id && canSee_(u, r)))) return true;   // RFQ attachments: buyer team, admin, or a supplier company that is allowed to see the RFQ — never any registered user
  if (all_('Messages').some(m => m.to_id === u.id && has(m.file_ids))) return true;
  return all_('Quotes').some(q => has(q.file_ids) && all_('RFQs').some(x => x.id === q.rfq_id && isBuyerSide_(u, x)));
}
const threadKey_ = (a, c) => [a, c].sort().join('_');

function marketH_() { return {
  rfq_create(b, u) {
    need_(b, ['title','quantity']); if (u.company_id && !can_(u.company_role, 'rfq.create') && !isAdmin_(u)) fail_('Your company role cannot create RFQs');
    const c = one_('Settings', s => s.key === 'rfq_counter'), n = Number(c.value) + 1; set_('Settings', 'rfq_counter', {value: n}, 'key'); _S = null; const f = {};
    ['title','description','category','quantity','unit','material','process','certification','location','delivery_date','budget','file_ids','invited'].forEach(k => f[k] = clean_(b[k]));
    const r = add_('RFQs', Object.assign(f, {status: b.publish === false ? 'Draft' : 'Published', visibility: VIS.indexOf(b.visibility) >= 0 ? b.visibility : 'Verified suppliers', rfq_no: 'RFQ-IA-' + ('000000' + n).slice(-6), owner_id: u.id, company_id: u.company_id || '', buyer_name: u.name, buyer_email: u.email}));
    return {id: r.id, rfq_no: r.rfq_no, matched: r.status === 'Published' ? notifyMatches_(r) : 0};
  },
  rfq_feed: (b, u) => ({data: all_('RFQs').filter(r => r.owner_id !== u.id && canSee_(u, r) && rfqLive_(r)).reverse().slice(0, 100).map(rfqOut_)}),
  rfq_mine: (b, u) => ({data: all_('RFQs').filter(r => isBuyerSide_(u, r)).reverse().slice(0, 100).map(r => Object.assign(rfqOut_(r), {responses: all_('Quotes').filter(q => q.rfq_id === r.id).length}))}),
  rfq_get(b, u) {
    const r = one_('RFQs', x => x.id === b.id); if (!r || (!canSee_(u, r) && !all_('Quotes').some(q => q.rfq_id === r.id && q.user_id === u.id))) fail_('RFQ not available'); const owner = isBuyerSide_(u, r), qs = all_('Quotes').filter(q => q.rfq_id === r.id && (owner || q.user_id === u.id));
    return {rfq: rfqOut_(r), owner, quotes: qs};
  },
  rfq_status(b, u) { const r = one_('RFQs', x => x.id === b.id); if (!r || !isBuyerSide_(u, r)) fail_('Not allowed'); if (RFQ_STATUS.indexOf(b.status) < 0) fail_('Invalid status'); set_('RFQs', r.id, {status: b.status}); if (b.status === 'Published' && r.status !== 'Published') notifyMatches_(r); audit_(u, 'rfq_status', r.rfq_no + ' ' + b.status); },
  rfq_match(b, u) { const r = one_('RFQs', x => x.id === b.id); if (!r || !isBuyerSide_(u, r)) fail_('Not allowed'); return {ai: true, extracted: extract_([r.title, r.description, r.material, r.process].join(' ')), matches: match_(r)}; },
  quote_submit(b, u) {
    const r = one_('RFQs', x => x.id === b.rfq_id); if (!r || !canSee_(u, r) || isBuyerSide_(u, r)) fail_('RFQ not available'); const co = coOf_(u); if (!co) fail_('Create your company profile first'); if (!can_(u.company_role, 'rfq.respond') && !isAdmin_(u)) fail_('Your company role cannot respond to RFQs');
    if (r.company_id && r.company_id === co.id) fail_('Your company cannot respond to its own RFQ'); if (planOf_(u).features.indexOf('rfq_access') < 0) fail_('Your plan does not include RFQ responses. Upgrade to Professional.');
    need_(b, ['lead_time']); const price = Number(b.price); if (!(price > 0)) fail_('Price must be a positive number'); if (['INR','USD','EUR'].indexOf(b.currency || 'INR') < 0) fail_('Invalid currency');
    add_('Quotes', {status: 'Submitted', rfq_id: r.id, user_id: u.id, company_id: co.id, company_name: co.name, price, currency: b.currency || 'INR', moq: clean_(b.moq), lead_time: clean_(b.lead_time), terms: clean_(b.terms), validity: clean_(b.validity), comments: clean_(b.comments), file_ids: clean_(b.file_ids)});
    if (r.status === 'Published' || r.status === 'Matching') set_('RFQs', r.id, {status: 'Responses Received'}); notify_(r.owner_id, 'New quotation on ' + r.rfq_no + ' from ' + co.name, '#/rfq/' + r.id);
    const o = one_('Users', x => x.id === r.owner_id); if (o) mail_(o.email, 'rfq_response', {name: o.name, rfq: r.rfq_no, supplier: co.name, link: S_('site_url') + '/portal.html#/rfq/' + r.id}); return {};
  },
  quote_status(b, u) {
    const q = one_('Quotes', x => x.id === b.id), r = q && one_('RFQs', x => x.id === q.rfq_id); if (!r || !isBuyerSide_(u, r)) fail_('Not allowed'); if (['Shortlisted','Rejected','Preferred','Clarification Requested'].indexOf(b.status) < 0) fail_('Invalid status');
    set_('Quotes', q.id, {status: b.status}); notify_(q.user_id, r.rfq_no + ': your quotation is now "' + b.status + '"');
  },

  // ---- messaging ----
  msg_send(b, u) {
    need_(b, ['to_id']); if (!String(b.body || '').trim() && !b.file_ids) fail_('Write a message'); limit_('m' + u.id, 30, 600); const to = one_('Users', x => x.id === b.to_id && x.status === 'Active'); if (!to || to.id === u.id) fail_('Recipient not found');
    if (one_('Blocks', x => x.user_id === to.id && x.blocked_id === u.id)) fail_('You cannot message this user');
    add_('Messages', {thread: threadKey_(u.id, to.id), from_id: u.id, to_id: to.id, body: clean_(b.body).slice(0, 4000), file_ids: clean_(b.file_ids), read: false}); notify_(to.id, 'New message from ' + u.name, '#/chat/' + u.id);
  },
  msg_inbox(b, u) {
    const users = all_('Users'), t = {}; all_('Messages').filter(m => m.from_id === u.id || m.to_id === u.id).forEach(m => { const o = m.from_id === u.id ? m.to_id : m.from_id, x = t[o] || (t[o] = {with: o, unread: 0}); x.last = m.body; x.at = m.created; if (m.to_id === u.id && !T_(m.read)) x.unread++; });
    const data = Object.keys(t).map(k => { const p = users.find(x => x.id === k); return Object.assign(t[k], {name: p ? p.name : 'User'}); }).sort((a, c) => String(c.at).localeCompare(String(a.at))); return {data, unread: data.reduce((n, x) => n + x.unread, 0)};
  },
  msg_thread(b, u) { const p = one_('Users', x => x.id === b.with); if (!p) fail_('User not found'); const th = threadKey_(u.id, p.id), ms = all_('Messages').filter(m => m.thread === th); ms.filter(m => m.to_id === u.id && !T_(m.read)).forEach(m => set_('Messages', m.id, {read: true}));
    return {with: {id: p.id, name: p.name}, data: ms.slice(-200).map(m => ({id: m.id, mine: m.from_id === u.id, body: m.body, at: m.created, file_ids: m.file_ids}))}; },
  msg_report(b, u) { audit_(u, 'report_user', b.with + ': ' + clean_(b.reason)); add_('Tickets', {status: 'Open', name: u.name, email: u.email, subject: 'User report', message: 'Reported ' + b.with + ': ' + clean_(b.reason), user_id: u.id}); adminMail_('User report', b.with); return {message: 'Reported. Admin will review it.'}; },
  msg_block(b, u) { if (!one_('Blocks', x => x.user_id === u.id && x.blocked_id === b.with)) add_('Blocks', {user_id: u.id, blocked_id: b.with}); return {message: 'User blocked.'}; },

  // ---- private files (Drive folder, owner/permission checked on every download) ----
  upload(b, u) {
    need_(b, ['name','data']); limit_('up' + u.id, 30, 3600); const name = String(b.name).replace(/[^\w.\- ]/g, '_').slice(0, 120), ext = name.split('.').pop().toLowerCase(); if (csv_(S_('allowed_ext')).indexOf(ext) < 0) fail_('File type not allowed');
    const bytes = Utilities.base64Decode(b.data); if (bytes.length > Number(S_('max_file_mb') || 5) * 1048576) fail_('File too large (max ' + S_('max_file_mb') + ' MB)'); if (!magicOk_(ext, bytes)) fail_('File content does not match its type');
    const f = folder_().createFile(Utilities.newBlob(bytes, 'application/octet-stream', uid_() + '_' + name)); f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    const rec = add_('Files', {owner_id: u.id, name, type: ext, size: bytes.length, drive_id: f.getId(), rfq_id: clean_(b.rfq_id), scan_status: 'unscanned'}); audit_(u, 'file_upload', rec.id); if (T_(S_('require_scan_for_sharing'))) adminMail_('File awaiting review', rec.name); return {id: rec.id, scan_status: 'unscanned'};
  },
  download(b, u) {
    const f = one_('Files', x => x.id === b.id); if (!f) fail_('File not found'); if (!fileAllowed_(u, f)) fail_(f.scan_status === 'unscanned' && T_(S_('require_scan_for_sharing')) ? 'File verification pending' : 'Not allowed');
    return {name: f.name, data: Utilities.base64Encode(DriveApp.getFileById(f.drive_id).getBlob().getBytes())};
  },
  files_mine: (b, u) => ({data: all_('Files').filter(f => f.owner_id === u.id).map(f => pick_(f, ['id','created','name','type','size','scan_status'])).reverse()}),
  file_scan_set(b, u) { const f = one_('Files', x => x.id === b.id); if (!f || ['clean','quarantined','unscanned'].indexOf(b.status) < 0) fail_('Invalid'); set_('Files', f.id, {scan_status: b.status}); audit_(u, 'file_scan', f.id + ' ' + b.status); if (b.status === 'quarantined') { try { DriveApp.getFileById(f.drive_id).setTrashed(true); } catch (e) {} } },

  // ---- notifications, saved ----
  notes: (b, u) => ({data: all_('Notifications').filter(n => n.user_id === u.id).reverse().slice(0, 50)}),
  notes_read(b, u) { all_('Notifications').filter(n => n.user_id === u.id && !T_(n.read)).forEach(n => set_('Notifications', n.id, {read: true})); },
  save_supplier(b, u) { if (!one_('Saved', s => s.user_id === u.id && s.company_id === b.company_id)) add_('Saved', {user_id: u.id, company_id: b.company_id}); },
  saved: (b, u) => { const ids = all_('Saved').filter(s => s.user_id === u.id).map(s => s.company_id); return {data: all_('Companies').filter(c => ids.indexOf(c.id) >= 0 && c.status === 'Approved').map(c => pick_(c, PUB.Companies))}; },
}; }
