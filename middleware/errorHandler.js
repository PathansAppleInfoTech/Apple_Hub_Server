const { error } = require('../utils/apiResponse');

// 404 handler for unmatched /api routes.
function notFound(req, res) {
  return error(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
}

// Centralized error handler — every controller can simply `next(err)`.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', err);

  if (err.code === 'ER_DUP_ENTRY') {
    return error(res, 'A record with these details already exists', 409);
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';
  return error(res, message, statusCode);
}

module.exports = { notFound, errorHandler };
