// Keyword matching (not an AI model): ported from the Apps Script version; uses only supplier-listed data.
const PROCS = ['cnc','machining','casting','forging','sheet metal','composite','additive','3d printing','welding','nde','ndt','inspection','testing','assembly','pcb','avionics','mro','overhaul','repair','tooling'];
const MATS = ['aluminium','aluminum','titanium','steel','stainless','inconel','magnesium','carbon fibre','carbon fiber','composite','nickel','copper','plastic'];
const extract = text => { const t = String(text).toLowerCase(), ax = t.match(/(\d)\s*-?\s*axis/); return {processes: PROCS.filter(p => t.includes(p)), materials: MATS.filter(m => t.includes(m)), machine: ax ? ax[1] + '-axis' : '', aerospace: /aero|aircraft|aviation|space|uav|drone/.test(t)}; };
function match(companies, r) {
  const q = extract([r.title, r.description, r.material, r.process, r.category].join(' ')), needCert = /required/i.test(r.certification || '');
  return companies.map(c => {
    const hay = [c.capabilities, c.products, c.services, c.materials, c.category].join(' ').toLowerCase(), why = [];
    q.processes.forEach(p => hay.includes(p) && why.push('Lists ' + p + ' capability')); q.materials.forEach(m => hay.includes(m) && why.push('Lists ' + m + ' material'));
    if (q.machine && hay.includes(q.machine)) why.push('Lists ' + q.machine + ' machining');
    if (q.aerospace && /aero|aviation|space|uav|drone/.test((String(c.industry) + ' ' + hay).toLowerCase())) why.push('Aerospace industry listed');
    if (!why.length) return null; const notes = [];
    if (!c.capabilities && !c.materials) notes.push('Capability information not available');
    if (needCert) notes.push(c.certifications ? 'Certifications self-declared: ' + c.certifications + ' (not independently verified unless badge shows)' : 'Certification information not available');
    return {score: why.length, company: {id: c.id, name: c.name, city: c.city, state: c.state, verification: c.verification, owner_id: c.owner_id}, why, notes};
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 20);
}
const approvedCompanies = db => db.query("SELECT c.*, (SELECT user_id FROM company_members WHERE company_id=c.id AND role='owner' LIMIT 1) AS owner_id FROM companies c WHERE c.status='Approved' AND c.merged_into IS NULL").then(r => r.rows);
module.exports = {extract, match, approvedCompanies};
