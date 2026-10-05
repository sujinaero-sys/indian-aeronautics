// Merge rule: never overwrite populated data. Fill only empty existing fields; both populated and different = conflict for admin to choose.
const FIELDS = ['name','description','website','email','phone','country','state','city','address','industry','category','type','products','services','capabilities','materials','certifications','contact_person','size','founded','export_capability'];
const has = v => v !== null && v !== undefined && String(v).trim() !== '';
const same = (a, b) => String(a).trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '') === String(b).trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
function previewMerge(existing, duplicate, choices = {}) {
  const final = {...existing}, changes = [], conflicts = [], retained = [];
  for (const f of FIELDS) {
    const e = existing[f], d = duplicate[f];
    if (!has(e) && has(d)) { final[f] = d; changes.push({field: f, from: e ?? null, to: d, why: 'filled empty'}); }
    else if (has(e) && has(d) && !same(e, d)) {
      if (choices[f] === 'duplicate') { final[f] = d; changes.push({field: f, from: e, to: d, why: 'admin chose duplicate'}); }
      else { conflicts.push({field: f, existing: e, duplicate: d, resolved: choices[f] === 'existing'}); retained.push(f); }
    } else if (has(e)) retained.push(f);
  }
  const open = conflicts.filter(c => !c.resolved).length;
  return {final, changes, conflicts, retained, needsDecision: open > 0};
}
module.exports = {FIELDS, previewMerge};
