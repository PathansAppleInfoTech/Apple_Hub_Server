const jwt = require('jsonwebtoken');

const config = require('../config/env');
const { error } = require('../utils/apiResponse');

function requireAuth(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.split(' ')[1]
    : null;

  const token = req.cookies?.accessToken || bearer;

  if (!token) {
    return error(
      res,
      'Authentication required',
      401,
      'AUTH_REQUIRED'
    );
  }

  try {
    const decoded = jwt.verify(
      token,
      config.jwtAccessSecret
    );

    req.admin = decoded;

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return error(
        res,
        'Access token expired',
        401,
        'AUTH_ACCESS_TOKEN_EXPIRED'
      );
    }

    return error(
      res,
      'Invalid access token',
      401,
      'AUTH_INVALID_ACCESS_TOKEN'
    );
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
