const { pool } = require('../config/db');
const { success, error } = require('../utils/apiResponse');
const { slugify } = require('../utils/generateOrderNumber');

const SERVICE_SELECT = `
  SELECT s.*, c.name AS category_name, c.slug AS category_slug
  FROM services s
  LEFT JOIN categories c ON c.id = s.category_id
`;

// GET /api/services  (public: active only, supports ?category=slug&search=term)
async function listServices(req, res, next) {
  try {
    const { category, search } = req.query;
    const clauses = ['s.is_active = 1'];
    const params = [];

    if (category) {
      clauses.push('c.slug = ?');
      params.push(category);
    }
    if (search) {
      clauses.push('(s.title LIKE ? OR s.short_description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const sql = `${SERVICE_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY s.created_at DESC`;
    const [rows] = await pool.query(sql, params);
    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/services/:idOrSlug
async function getService(req, res, next) {
  try {
    const { idOrSlug } = req.params;
    const isNumeric = /^\d+$/.test(idOrSlug);
    const sql = `${SERVICE_SELECT} WHERE ${isNumeric ? 's.id = ?' : 's.slug = ?'} LIMIT 1`;
    const [rows] = await pool.query(sql, [idOrSlug]);

    if (!rows[0]) return error(res, 'Service not found', 404);
    return success(res, rows[0]);
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/services (admin: everything incl. inactive)
async function listAllServices(req, res, next) {
  try {
    const [rows] = await pool.query(`${SERVICE_SELECT} ORDER BY s.created_at DESC`);
    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// POST /api/services
async function createService(req, res, next) {
  try {
    const { title, category_id, short_description, description, price, image } = req.body;
    if (!title || price === undefined) {
      return error(res, 'Title and price are required', 422);
    }

    const slug = slugify(title);
    const [result] = await pool.query(
      `INSERT INTO services
        (category_id, title, slug, short_description, description, price, image, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [category_id || null, title, slug, short_description || null, description || null, price, image || null]
    );

    const [rows] = await pool.query(`${SERVICE_SELECT} WHERE s.id = ?`, [result.insertId]);
    return success(res, rows[0], 'Service created', 201);
  } catch (err) {
    next(err);
  }
}

// PUT /api/services/:id
async function updateService(req, res, next) {
  try {
    const { id } = req.params;
    const [existingRows] = await pool.query('SELECT * FROM services WHERE id = ?', [id]);
    const existing = existingRows[0];
    if (!existing) return error(res, 'Service not found', 404);

    const { title, category_id, short_description, description, price, image, is_active } = req.body;
    const slug = title ? slugify(title) : existing.slug;

    await pool.query(
      `UPDATE services SET
        title = ?, slug = ?, category_id = ?, short_description = ?,
        description = ?, price = ?, image = ?, is_active = ?
       WHERE id = ?`,
      [
        title ?? existing.title,
        slug,
        category_id !== undefined ? category_id : existing.category_id,
        short_description ?? existing.short_description,
        description ?? existing.description,
        price !== undefined ? price : existing.price,
        image ?? existing.image,
        is_active !== undefined ? is_active : existing.is_active,
        id,
      ]
    );

    const [rows] = await pool.query(`${SERVICE_SELECT} WHERE s.id = ?`, [id]);
    return success(res, rows[0], 'Service updated');
  } catch (err) {
    next(err);
  }
}

// DELETE /api/services/:id
// Services that already have orders are soft-deleted (deactivated) so
// historical orders keep valid references; services with zero orders
// can be removed outright.
async function deleteService(req, res, next) {
  try {
    const { id } = req.params;
    const [orderRows] = await pool.query('SELECT COUNT(*) AS cnt FROM orders WHERE service_id = ?', [id]);
    const hasOrders = orderRows[0].cnt > 0;

    if (hasOrders) {
      const [result] = await pool.query('UPDATE services SET is_active = 0 WHERE id = ?', [id]);
      if (result.affectedRows === 0) return error(res, 'Service not found', 404);
      return success(res, null, 'Service has existing orders — deactivated instead of deleted');
    }

    const [result] = await pool.query('DELETE FROM services WHERE id = ?', [id]);
    if (result.affectedRows === 0) return error(res, 'Service not found', 404);
    return success(res, null, 'Service deleted');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listServices,
  getService,
  listAllServices,
  createService,
  updateService,
  deleteService,
};
