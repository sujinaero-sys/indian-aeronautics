const A = require('./auth'), {ApiError} = require('./http');
const attachUser = db => async (req, res, next) => { try { req.user = await A.userFromToken(db, req.cookies && req.cookies.ia_sid); next(); } catch (e) { next(e); } };
const requireAuth = (req, res, next) => req.user ? next() : next(new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required.'));
const requireAdmin = (req, res, next) => !req.user ? next(new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required.')) : req.user.roles.includes('admin') ? next() : next(new ApiError(403, 'FORBIDDEN', 'Administrator access required.'));
module.exports = {attachUser, requireAuth, requireAdmin};
