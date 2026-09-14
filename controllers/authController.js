const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { pool } = require('../config/db');
const config = require('../config/env');
const { success, error } = require('../utils/apiResponse');

const ACCESS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'lax',
  maxAge: 15 * 60 * 1000,
  path: '/',
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/auth',
};

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    // Validate input
    if (!email || !password) {
      return error(
        res,
        'Email and password are required',
        422,
        'AUTH_FIELDS_REQUIRED'
      );
    }

    // Find account
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

    // Account does not exist
    if (!admin) {
      return error(
        res,
        'No account exists with this email address.',
        401,
        'ACCOUNT_NOT_FOUND'
      );
    }

    // Account exists but is inactive
    if (!Number(admin.is_active)) {
      return error(
        res,
        'Your account is inactive. Please contact an administrator.',
        403,
        'ACCOUNT_INACTIVE'
      );
    }

    // Check password
    const isMatch = await bcrypt.compare(
      password,
      admin.password
    );

    if (!isMatch) {
      return error(
        res,
        'The password you entered is incorrect.',
        401,
        'INVALID_PASSWORD'
      );
    }

    // Public admin payload
    const payload = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    };

    // Short-lived access token
    const accessToken = jwt.sign(
      payload,
      config.jwtAccessSecret,
      {
        expiresIn: config.jwtAccessExpiresIn,
      }
    );

    // Long-lived refresh token
    const refreshToken = jwt.sign(
      {
        id: admin.id,
        type: 'refresh',
      },
      config.jwtRefreshSecret,
      {
        expiresIn: config.jwtRefreshExpiresIn,
      }
    );

    // HTTP-only access cookie
    res.cookie(
      'accessToken',
      accessToken,
      ACCESS_COOKIE_OPTIONS
    );

    // HTTP-only refresh cookie
    res.cookie(
      'refreshToken',
      refreshToken,
      REFRESH_COOKIE_OPTIONS
    );

    return success(
      res,
      { admin: payload },
      'Logged in successfully'
    );
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/refresh
async function refresh(req, res, next) {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return error(res, 'Refresh token required', 401);
    }

    let decoded;

    try {
      decoded = jwt.verify(
        refreshToken,
        config.jwtRefreshSecret
      );
    } catch (err) {
      return error(res, 'Invalid or expired refresh token', 401);
    }

    if (decoded.type !== 'refresh') {
      return error(res, 'Invalid refresh token', 401);
    }

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
      [decoded.id]
    );

    const admin = rows[0];

    if (!admin || !admin.is_active) {
      return error(res, 'Account is inactive or unavailable', 401);
    }

    const payload = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    };

    const newAccessToken = jwt.sign(
      payload,
      config.jwtAccessSecret,
      {
        expiresIn: config.jwtAccessExpiresIn,
      }
    );

    res.cookie(
      'accessToken',
      newAccessToken,
      ACCESS_COOKIE_OPTIONS
    );

    return success(
      res,
      { admin: payload },
      'Access token refreshed'
    );
  } catch (err) {
    next(err);
  }
}

// POST /api/auth/logout
function logout(req, res) {
  res.clearCookie(
    'accessToken',
    ACCESS_COOKIE_OPTIONS
  );

  res.clearCookie(
    'refreshToken',
    REFRESH_COOKIE_OPTIONS
  );

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
  refresh,
  logout,
  me,
};
