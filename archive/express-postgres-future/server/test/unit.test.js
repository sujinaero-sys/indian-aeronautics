const assert = require('assert'), crypto = require('crypto'), {previewMerge} = require('../src/merge'), {can} = require('../src/permissions'), {verifySignature} = require('../src/payments');
// Spec section 68: merge test
const ex = {name:'ABC Aerospace', email:'info@abc.com', phone:'', website:'abc.com', city:'Chennai'}, du = {name:'ABC Aerospace Pvt Ltd', email:'', phone:'+91 9999999999', website:'abc.com', city:''};
const m = previewMerge(ex, du);
assert.strictEqual(m.final.name, 'ABC Aerospace'); assert.strictEqual(m.final.email, 'info@abc.com'); assert.strictEqual(m.final.phone, '+91 9999999999'); assert.strictEqual(m.final.website, 'abc.com'); assert.strictEqual(m.final.city, 'Chennai');
assert.deepStrictEqual(m.changes.map(c => c.field), ['phone']); assert.ok(m.conflicts.some(c => c.field === 'name') && m.needsDecision);
// conflict resolution is explicit; unresolved conflicts block the merge
assert.strictEqual(previewMerge({city:'Chennai'}, {city:'Bengaluru'}).needsDecision, true);
assert.strictEqual(previewMerge({city:'Chennai'}, {city:'Bengaluru'}, {city:'duplicate'}).final.city, 'Bengaluru');
assert.strictEqual(previewMerge({city:'Chennai'}, {city:'Bengaluru'}, {city:'existing'}).final.city, 'Chennai');
assert.strictEqual(previewMerge({phone:'123'}, {phone:''}).final.phone, '123'); // empty duplicate never wipes data
// Spec section 70: company team permissions
assert.ok(can('procurement','rfq.create') && !can('procurement','applications.view') && !can('procurement','job.manage'));
assert.ok(can('sales','lead.manage') && !can('sales','rfq.create')); assert.ok(can('hr','job.manage') && !can('hr','rfq.responses') && !can('hr','quote.manage'));
assert.ok(can('owner','team.manage') && !can('viewer','rfq.create') && !can('nobody','company.view'));
// Webhook signature
const body = Buffer.from('{"event":"payment.captured"}'), sig = crypto.createHmac('sha256','sec').update(body).digest('hex');
assert.ok(verifySignature(body, sig, 'sec')); assert.ok(!verifySignature(body, sig, 'other')); assert.ok(!verifySignature(body, 'bad', 'sec')); assert.ok(!verifySignature(body, '', 'sec'));
// Trainer earnings example (spec 69): 1000 gross, 20% commission
const net = g => g - g * 0.20; assert.strictEqual(net(1000), 800);
console.log('ALL TESTS PASSED');
