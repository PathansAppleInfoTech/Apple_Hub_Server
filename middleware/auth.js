const jwt = require('jsonwebtoken');

const config = require('../config/env');
const { error } = require('../utils/apiResponse');

function requireAuth(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : null;

  // Prefer HTTP-only cookie, but also support Bearer tokens
  const token = req.cookies?.token || bearer;

  if (!token) {
    return error(res, 'Authentication required', 401);
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);

    req.admin = decoded;

    next();
  } catch (err) {
    return error(res, 'Invalid or expired session', 401);
  }
}

// Restricts a route to specific roles, e.g. requireRole('admin').
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return error(res, 'You do not have permission to do this', 403);
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
