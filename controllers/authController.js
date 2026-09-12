const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { pool } = require('../config/db');
const config = require('../config/env');
const { success, error } = require('../utils/apiResponse');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return error(res, 'Email and password are required', 422);
    }

    const [rows] = await pool.query(
      `
        SELECT
          id,
          name,
          email,
          password,
          role,
          is_active
        FROM admins
        WHERE email = ?
        LIMIT 1
      `,
      [email]
    );

    const admin = rows[0];

    if (!admin || !admin.is_active) {
      return error(res, 'Invalid email or password', 401);
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return error(res, 'Invalid email or password', 401);
    }

    const payload = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    };

    const token = jwt.sign(
      payload,
      config.jwtSecret,
      {
        expiresIn: config.jwtExpiresIn,
      }
    );

    res.cookie('token', token, COOKIE_OPTIONS);

    return success(
      res,
      { admin: payload },
      'Logged in successfully'
    );
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/logout
function logout(req, res) {
  res.clearCookie('token', COOKIE_OPTIONS);

  return success(
    res,
    null,
    'Logged out successfully'
  );
}

// GET /api/auth/me
async function me(req, res, next) {
  try {
    const [rows] = await pool.query(
      `
        SELECT
          id,
          name,
          email,
          role,
          is_active
        FROM admins
        WHERE id = ?
        LIMIT 1
      `,
      [req.admin.id]
    );

    const admin = rows[0];

    if (!admin || !admin.is_active) {
      return error(res, 'Admin account is not available', 401);
    }

    return success(res, { admin });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login,
  logout,
  me,
};
