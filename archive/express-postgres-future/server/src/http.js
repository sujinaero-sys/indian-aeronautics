class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const ok = (res, data = {}, status = 200) => res.status(status).json({success: true, data});
const h = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const bad = (m, code = 'VALIDATION_ERROR') => new ApiError(400, code, m);
const str = (v, field, {min = 0, max = 500, required = false} = {}) => { v = v == null ? '' : String(v).trim(); if (required && !v) throw bad(field + ' is required'); if (v.length < min || v.length > max) throw bad(`${field} must be ${min}-${max} characters`); return v; };
const email = v => { v = str(v, 'email', {required: true, max: 254}).toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw bad('Invalid email address'); return v; };
const password = v => { v = String(v || ''); if (v.length < 8 || v.length > 128 || !/[A-Za-z]/.test(v) || !/\d/.test(v)) throw bad('Password must be 8-128 characters with at least one letter and one number'); return v; };
const id = (v, field = 'id') => { if (!/^\d{1,18}$/.test(String(v))) throw bad('Invalid ' + field); return String(v); };
const page = q => { const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 25)), p = Math.max(1, parseInt(q.page, 10) || 1); return {limit, page: p, offset: (p - 1) * limit}; };
const oneOf = (v, list, field) => { if (!list.includes(v)) throw bad('Invalid ' + field); return v; };
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) return res.status(err.status).json({success: false, error: {code: err.code, message: err.message}});
  if (err.type === 'entity.parse.failed') return res.status(400).json({success: false, error: {code: 'BAD_JSON', message: 'Invalid JSON body.'}});
  if (err.code === '22P02' || err.code === '22003') return res.status(400).json({success: false, error: {code: 'VALIDATION_ERROR', message: 'Invalid value.'}});
  console.error(err); res.status(500).json({success: false, error: {code: 'SERVER_ERROR', message: 'Something went wrong. Please try again or contact info@buye.online.'}});
}
module.exports = {ApiError, ok, h, bad, str, email, password, id, page, oneOf, errorHandler};
