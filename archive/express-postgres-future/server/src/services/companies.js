const {can} = require('../permissions'), {ApiError} = require('../http');
const FIELDS = ['name','description','website','email','phone','country','state','city','address','industry','category','type','products','services','capabilities','materials','certifications','contact_person','size','founded','export_capability'];
const PUBLIC = ['id','name','description','website','country','state','city','industry','category','type','products','services','capabilities','materials','certifications','size','founded','export_capability','verification'];
const membership = async (db, uid) => (await db.query('SELECT cm.company_id, cm.role FROM company_members cm WHERE cm.user_id=$1 ORDER BY cm.company_id LIMIT 1', [uid])).rows[0] || null;
const completion = c => { const f = ['description','website','email','phone','capabilities','products','materials','certifications','city','contact_person','size','export_capability']; return Math.round(100 * f.filter(k => String(c[k] || '').trim()).length / f.length); };
// Authorization: platform admin, or a member whose company role grants `perm`. Never trusts the ID in the URL alone.
async function authorize(db, user, companyId, perm) {
  if (user.roles.includes('admin')) return 'admin';
  const r = (await db.query('SELECT role FROM company_members WHERE company_id=$1 AND user_id=$2', [companyId, user.id])).rows[0];
  if (!r || !can(r.role, perm)) throw new ApiError(403, 'FORBIDDEN', 'Not allowed for your role in this company.');
  return r.role;
}
const pickPublic = c => Object.fromEntries(PUBLIC.map(k => [k, c[k]]));
module.exports = {FIELDS, PUBLIC, membership, completion, authorize, pickPublic};
