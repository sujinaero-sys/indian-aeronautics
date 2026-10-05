// In-memory simulation of the Google services the backend uses (Sheets, Drive, Mail, Cache, Lock, UrlFetch, Properties, Triggers).
const vm = require('vm'), fs = require('fs'), path = require('path'), crypto = require('crypto');
function createEnv(opts = {}) {
  const sheets = {}, drive = {files: {}, folders: {}}, mails = [], props = Object.assign({}, opts.props), fetches = [], cache = {}, fetchHandlers = opts.fetch || (() => ({code: 404, text: '{}'}));
  const chain = {setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }};
  function Sheet(name) { const s = {name, data: []};
    s.getDataRange = () => ({getValues: () => s.data.map(r => r.slice())}); s.getLastRow = () => s.data.length; s.getLastColumn = () => s.data.reduce((m, r) => Math.max(m, r.length), 0); s.setFrozenRows = () => {};
    s.getRange = (r, c, nr = 1, nc = 1) => Object.assign({getValues: () => { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((s.data[r - 1 + i] || [])[c - 1 + j] ?? ''); o.push(row); } return o; },
      setValues: v => { v.forEach((row, i) => row.forEach((x, j) => { (s.data[r - 1 + i] = s.data[r - 1 + i] || [])[c - 1 + j] = x; })); return chain; }, setValue: x => { (s.data[r - 1] = s.data[r - 1] || [])[c - 1] = x; return chain; }}, chain);
    s.appendRow = row => { s.data.push(row.slice()); }; return s; }
  drive.files.ss1 = {id: 'ss1', name: 'spreadsheet', bytes: [1, 2, 3], trashed: false, created: 0};
  const ss = {getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = Sheet(n)), getSheets: () => Object.values(sheets), deleteSheet: s => { delete sheets[s.name]; }, getId: () => 'ss1'};
  const wrap = f => ({getId: () => f.id, setSharing: (a, p) => { f.sharing = [a, p]; }, getName: () => f.name, getBlob: () => ({getBytes: () => f.bytes}), setTrashed: t => { f.trashed = t; }, getDateCreated: () => f.created, makeCopy: (n, fol) => fol.createFile({bytes: f.bytes, name: n})});
  let seqId = 0, tick = 0;
  const mkFile = (bytes, name) => { const id = 'f' + (++seqId); const f = {id, name, bytes: Array.from(bytes), trashed: false, sharing: null, created: ++tick}; drive.files[id] = f; return wrap(f); };
  const mkFolder = n => ({createFile: blob => mkFile(blob.bytes, blob.name), getFiles: () => { let i = 0; const l = Object.values(drive.files).filter(f => !f.trashed && f.id !== 'ss1'); return {hasNext: () => i < l.length, next: () => wrap(l[i++])}; }});
  const ctx = {
    console, Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, parseInt, parseFloat, isFinite, encodeURIComponent,
    SpreadsheetApp: {getActiveSpreadsheet: () => ss},
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: t => ({text: t, setMimeType() { return this; }})},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    CacheService: {getScriptCache: () => ({get: k => (cache[k] && cache[k].exp > Date.now() ? cache[k].v : null), put: (k, v, s) => { cache[k] = {v, exp: Date.now() + s * 1000}; }})},
    PropertiesService: {getScriptProperties: () => ({getProperty: k => props[k] ?? null})},
    Utilities: {getUuid: () => crypto.randomUUID(), computeDigest: (a, s) => Array.from(crypto.createHash('sha256').update(s).digest()).map(b => b > 127 ? b - 256 : b), base64Encode: v => Buffer.from(typeof v === 'string' ? v : Buffer.from(v.map(b => b & 255))).toString('base64'),
      base64Decode: s => Array.from(Buffer.from(s, 'base64')).map(b => b > 127 ? b - 256 : b), newBlob: (bytes, t, name) => ({bytes: bytes.map(b => b & 255), name}), computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()).map(b => b > 127 ? b - 256 : b)},
    DigestAlgorithm: undefined, MailApp: {getRemainingDailyQuota: () => opts.quota ?? 100, sendEmail: o => { if (opts.mailFail) throw new Error('mail down'); mails.push(o); }},
    GmailApp: {sendEmail: (to, subject, body, o) => { if (opts.mailFail) throw new Error('mail down'); mails.push({to, subject, body, ...o}); }},
    DriveApp: {Access: {PRIVATE: 'PRIVATE'}, Permission: {NONE: 'NONE'}, getFoldersByName: n => { let done = !drive.folders[n]; return {hasNext: () => !done, next: () => { done = true; return mkFolder(n); }}; }, createFolder: n => { drive.folders[n] = true; return mkFolder(n); }, getFileById: id => wrap(drive.files[id])},
    UrlFetchApp: {fetch: (url, o) => { fetches.push({url, o}); const r = fetchHandlers(url, o); return {getResponseCode: () => r.code, getContentText: () => r.text}; }},
    ScriptApp: {getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({timeBased: () => ({everyMinutes: () => ({create() {}}), everyWeeks: () => ({create() {}})})})},
  };
  ctx.Utilities.DigestAlgorithm = {SHA_256: 'sha256'}; ctx.Utilities.computeDigest = (alg, s) => Array.from(crypto.createHash('sha256').update(s).digest()).map(b => b > 127 ? b - 256 : b); ctx.DigestAlgorithm = ctx.Utilities.DigestAlgorithm;
  vm.createContext(ctx);
  const dir = process.env.GAS_DIR || path.join(__dirname, '..', 'backend'); vm.runInContext(['Code.gs', 'Company.gs', 'Market.gs', 'Money.gs', 'Admin.gs'].map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') + '\nthis.__x = {doGet, doPost, setup, processOutbox, backup_, all_, set_, add_};', ctx);
  const X = ctx.__x; X.setup();
  const post = (token, action, body = {}) => JSON.parse(X.doPost({postData: {contents: JSON.stringify({...body, action, token})}}).text);
  const get = params => JSON.parse(X.doGet({parameter: params}).text);
  return {...X, post, get, sheets, drive, mails, props, fetches, ctx, cache};
}
module.exports = {createEnv};
