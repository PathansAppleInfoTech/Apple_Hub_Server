const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { success, error } = require('../utils/apiResponse');

const SAFE_FIELDS = `
  id,
  name,
  email,
  role,
  is_active,
  created_at,
  updated_at
`;

// GET /api/admin/team
async function listTeam(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT ${SAFE_FIELDS}
       FROM admins
       ORDER BY created_at DESC`
    );

    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// POST /api/admin/team
async function createTeamMember(req, res, next) {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = req.body.role === 'admin' ? 'admin' : 'staff';

    if (!name || !email || !password) {
      return error(res, 'Name, email and password are required', 422);
    }

    if (name.length < 2) {
      return error(res, 'Name must be at least 2 characters', 422);
    }

    if (name.length > 120) {
      return error(res, 'Name is too long', 422);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return error(res, 'Please enter a valid email address', 422);
    }

    if (password.length < 8) {
      return error(res, 'Password must be at least 8 characters', 422);
    }

    // Check duplicate email before attempting insert
    const [existingRows] = await pool.query(
      'SELECT id FROM admins WHERE email = ? LIMIT 1',
      [email]
    );

    if (existingRows.length > 0) {
      return error(res, 'An account with this email already exists', 409);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO admins
        (name, email, password, role, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [name, email, hashedPassword, role]
    );

    const [rows] = await pool.query(
      `SELECT ${SAFE_FIELDS}
       FROM admins
       WHERE id = ?
       LIMIT 1`,
      [result.insertId]
    );

    console.log(
      `[admin] Team member created: ${email} (${role})`
    );

    return success(
      res,
      rows[0],
      'Team member created',
      201
    );
  } catch (err) {
    // MySQL duplicate-key fallback
    if (err.code === 'ER_DUP_ENTRY') {
      return error(
        res,
        'An account with this email already exists',
        409
      );
    }

    next(err);
  }
}

// PUT /api/admin/team/:id
async function updateTeamMember(req, res, next) {
  try {
    const { id } = req.params;

    const [existingRows] = await pool.query(
      `SELECT id, name, email, password, role, is_active
       FROM admins
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    const existing = existingRows[0];

    if (!existing) {
      return error(res, 'Team member not found', 404);
    }

    const name =
      req.body.name !== undefined
        ? String(req.body.name).trim()
        : existing.name;

    const email =
      req.body.email !== undefined
        ? String(req.body.email).trim().toLowerCase()
        : existing.email;

    const role =
      req.body.role === 'admin' || req.body.role === 'staff'
        ? req.body.role
        : existing.role;

    const isActive =
      req.body.is_active !== undefined
        ? Number(req.body.is_active) === 1
          ? 1
          : 0
        : existing.is_active;

    const password =
      req.body.password !== undefined
        ? String(req.body.password)
        : '';

    if (!name) {
      return error(res, 'Name is required', 422);
    }

    if (name.length < 2) {
      return error(res, 'Name must be at least 2 characters', 422);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return error(res, 'Please enter a valid email address', 422);
    }

    if (password && password.length < 8) {
      return error(res, 'Password must be at least 8 characters', 422);
    }

    // Prevent the currently logged-in admin from disabling
    // their own account.
    if (Number(id) === Number(req.admin.id) && isActive === 0) {
      return error(
        res,
        'You cannot deactivate your own account',
        422
      );
    }

    // Check whether another account already uses this email
    const [duplicateRows] = await pool.query(
      `SELECT id
       FROM admins
       WHERE email = ?
         AND id <> ?
       LIMIT 1`,
      [email, id]
    );

    if (duplicateRows.length > 0) {
      return error(
        res,
        'Another account is already using this email',
        409
      );
    }

    let hashedPassword = existing.password;

    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    await pool.query(
      `UPDATE admins
       SET
         name = ?,
         email = ?,
         role = ?,
         is_active = ?,
         password = ?
       WHERE id = ?`,
      [
        name,
        email,
        role,
        isActive,
        hashedPassword,
        id,
      ]
    );

    const [rows] = await pool.query(
      `SELECT ${SAFE_FIELDS}
       FROM admins
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    console.log(
      `[admin] Team member updated: ${email} (${role}, active=${isActive})`
    );

    return success(
      res,
      rows[0],
      'Team member updated'
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return error(
        res,
        'Another account is already using this email',
        409
      );
    }

    next(err);
  }
}

module.exports = {
  listTeam,
  createTeamMember,
  updateTeamMember,
};
