// Small helpers so every endpoint returns a consistent JSON shape:
//   success -> { success: true, data, message? }
//   error   -> { success: false, message, errors? }

function success(res, data = null, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}

function error(
  res,
  message,
  statusCode = 500,
  code = null
) {
  return res.status(statusCode).json({
    success: false,
    message,
    ...(code ? { code } : {}),
  });
}
module.exports = { success, error };
