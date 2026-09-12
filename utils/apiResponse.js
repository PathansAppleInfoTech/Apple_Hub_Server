// Small helpers so every endpoint returns a consistent JSON shape:
//   success -> { success: true, data, message? }
//   error   -> { success: false, message, errors? }

function success(res, data = null, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}

function error(res, message = 'Something went wrong', statusCode = 500, errors = null) {
  return res.status(statusCode).json({ success: false, message, errors });
}

module.exports = { success, error };
