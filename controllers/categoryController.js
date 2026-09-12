const { pool } = require('../config/db');
const { success, error } = require('../utils/apiResponse');
const { slugify } = require('../utils/generateOrderNumber');

// GET /api/categories
async function listCategories(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT *
       FROM categories
       WHERE is_active = 1
       ORDER BY name ASC`
    );

    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/categories
async function listAllCategories(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT *
       FROM categories
       ORDER BY created_at DESC`
    );

    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// POST /api/categories
async function createCategory(req, res, next) {
  try {
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();

    if (!name) {
      return error(res, 'Category name is required', 422);
    }

    if (name.length < 2) {
      return error(
        res,
        'Category name must be at least 2 characters',
        422
      );
    }

    if (name.length > 120) {
      return error(res, 'Category name is too long', 422);
    }

    const slug = slugify(name);

    // Check duplicate name/slug
    const [existingRows] = await pool.query(
      `SELECT id
       FROM categories
       WHERE slug = ?
       LIMIT 1`,
      [slug]
    );

    if (existingRows.length > 0) {
      return error(
        res,
        'A category with this name already exists',
        409
      );
    }

    const [result] = await pool.query(
      `INSERT INTO categories
        (name, slug, description, is_active)
       VALUES (?, ?, ?, 1)`,
      [
        name,
        slug,
        description || null,
      ]
    );

    const [rows] = await pool.query(
      `SELECT *
       FROM categories
       WHERE id = ?
       LIMIT 1`,
      [result.insertId]
    );

    console.log(
      `[Categories] Created: ${name} (id=${result.insertId})`
    );

    return success(
      res,
      rows[0],
      'Category created successfully',
      201
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return error(
        res,
        'A category with this name already exists',
        409
      );
    }

    next(err);
  }
}

// PUT /api/categories/:id
async function updateCategory(req, res, next) {
  try {
    const { id } = req.params;

    const [existingRows] = await pool.query(
      `SELECT *
       FROM categories
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    const existing = existingRows[0];

    if (!existing) {
      return error(res, 'Category not found', 404);
    }

    const name =
      req.body.name !== undefined
        ? String(req.body.name).trim()
        : existing.name;

    const description =
      req.body.description !== undefined
        ? String(req.body.description).trim()
        : existing.description;

    const isActive =
      req.body.is_active !== undefined
        ? Number(req.body.is_active) === 1
          ? 1
          : 0
        : existing.is_active;

    if (!name) {
      return error(res, 'Category name is required', 422);
    }

    if (name.length < 2) {
      return error(
        res,
        'Category name must be at least 2 characters',
        422
      );
    }

    const slug = slugify(name);

    // Make sure another category isn't using this slug
    const [duplicateRows] = await pool.query(
      `SELECT id
       FROM categories
       WHERE slug = ?
         AND id <> ?
       LIMIT 1`,
      [slug, id]
    );

    if (duplicateRows.length > 0) {
      return error(
        res,
        'Another category with this name already exists',
        409
      );
    }

    await pool.query(
      `UPDATE categories
       SET
         name = ?,
         slug = ?,
         description = ?,
         is_active = ?
       WHERE id = ?`,
      [
        name,
        slug,
        description || null,
        isActive,
        id,
      ]
    );

    const [rows] = await pool.query(
      `SELECT *
       FROM categories
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    console.log(
      `[Categories] Updated: ${name} (id=${id})`
    );

    return success(
      res,
      rows[0],
      'Category updated successfully'
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return error(
        res,
        'Another category with this name already exists',
        409
      );
    }

    next(err);
  }
}

// DELETE /api/categories/:id
async function deactivateCategory(req, res, next) {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `UPDATE categories
       SET is_active = 0
       WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return error(res, 'Category not found', 404);
    }

    console.log(
      `[Categories] Deactivated: id=${id}`
    );

    return success(
      res,
      null,
      'Category deactivated successfully'
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCategories,
  listAllCategories,
  createCategory,
  updateCategory,
  deactivateCategory,
};
