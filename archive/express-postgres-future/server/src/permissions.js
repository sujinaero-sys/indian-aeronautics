const P = {
  owner: ['company.manage','team.manage','rfq.create','rfq.responses','quote.manage','lead.manage','rfq.respond','job.manage','applications.view','capability.manage','analytics.company','company.view'],
  admin: ['company.manage','team.manage','analytics.company','company.view','capability.manage'],
  procurement: ['rfq.create','rfq.responses','quote.manage','company.view'],
  sales: ['lead.manage','rfq.respond','company.view'],
  hr: ['job.manage','applications.view','company.view'],
  engineering: ['capability.manage','rfq.respond','company.view'],
  viewer: ['company.view'],
};
const can = (role, perm) => !!P[role] && P[role].includes(perm);
module.exports = {P, can, ROLES: Object.keys(P)};
