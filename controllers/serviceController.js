const { pool } = require('../config/db');
const { success, error } = require('../utils/apiResponse');
const { slugify } = require('../utils/generateOrderNumber');

const SERVICE_SELECT = `
  SELECT
    s.*,
    c.name AS category_name,
    c.slug AS category_slug
  FROM services s
  LEFT JOIN categories c ON c.id = s.category_id
`;

/**
 * Convert MySQL JSON fields into JavaScript arrays.
 * Depending on mysql2 configuration/version, JSON can already
 * come back as an object/array or as a string.
 */
function parseJson(value, fallback = []) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Normalize service data before returning it to the frontend.
 */
function formatService(service) {
  if (!service) return null;

  return {
    ...service,

    price:
      service.price === null || service.price === undefined
        ? null
        : Number(service.price),

    popular: Boolean(service.popular),

    features: parseJson(service.features, []),
    notes: parseJson(service.notes, []),

    freebies: service.freebies || null,
  };
}


// ============================================================
// GET /api/services
// Public: active services only
// Supports:
// ?category=facebook-instagram
// ?search=poster
// ============================================================

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
      clauses.push(`
        (
          s.title LIKE ?
          OR s.short_description LIKE ?
          OR s.description LIKE ?
          OR s.tier LIKE ?
        )
      `);

      const searchTerm = `%${search}%`;

      params.push(
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm
      );
    }

    const sql = `
      ${SERVICE_SELECT}
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        s.popular DESC,
        s.created_at DESC
    `;

    const [rows] = await pool.query(sql, params);

    return success(
      res,
      rows.map(formatService)
    );
  } catch (err) {
    next(err);
  }
}


// ============================================================
// GET /api/services/:idOrSlug
// ============================================================

async function getService(req, res, next) {
  try {
    const { idOrSlug } = req.params;

    const isNumeric = /^\d+$/.test(idOrSlug);

    const sql = `
      ${SERVICE_SELECT}
      WHERE ${isNumeric ? 's.id = ?' : 's.slug = ?'}
      AND s.is_active = 1
      LIMIT 1
    `;

    const [rows] = await pool.query(sql, [idOrSlug]);

    if (!rows[0]) {
      return error(res, 'Service not found', 404);
    }

    return success(
      res,
      formatService(rows[0])
    );
  } catch (err) {
    next(err);
  }
}


// ============================================================
// GET /api/admin/services
// Admin: all services including inactive
// ============================================================

async function listAllServices(req, res, next) {
  try {
    const [rows] = await pool.query(`
      ${SERVICE_SELECT}
      ORDER BY
        s.created_at DESC
    `);

    return success(
      res,
      rows.map(formatService)
    );
  } catch (err) {
    next(err);
  }
}


// ============================================================
// POST /api/services
// ============================================================

async function createService(req, res, next) {
  try {
    const {
      title,
      category_id,
      tier,
      short_description,
      description,
      price,
      price_suffix,
      duration,
      popular,
      features,
      notes,
      freebies,
      image,
      is_active,
    } = req.body;

    // ----------------------------------------------------------
    // Validation
    // ----------------------------------------------------------

    if (!title || !title.trim()) {
      return error(res, 'Service title is required', 422);
    }

    // IMPORTANT:
    // price can be NULL because some services are Custom priced.
    if (price === undefined) {
      return error(
        res,
        'Price is required. Use null for custom pricing.',
        422
      );
    }

    if (price !== null && (isNaN(price) || Number(price) < 0)) {
      return error(res, 'Price must be a valid positive number or null', 422);
    }

    const cleanTitle = title.trim();
    const slug = slugify(cleanTitle);

    // ----------------------------------------------------------
    // Check duplicate slug
    // ----------------------------------------------------------

    const [existingRows] = await pool.query(
      'SELECT id FROM services WHERE slug = ? LIMIT 1',
      [slug]
    );

    if (existingRows.length > 0) {
      return error(
        res,
        'A service with this title already exists',
        409
      );
    }

    // ----------------------------------------------------------
    // Normalize arrays
    // ----------------------------------------------------------

    const cleanFeatures = Array.isArray(features)
      ? features.filter(Boolean)
      : [];

    const cleanNotes = Array.isArray(notes)
      ? notes.filter(Boolean)
      : [];

    // ----------------------------------------------------------
    // Insert
    // ----------------------------------------------------------

    const [result] = await pool.query(
      `
      INSERT INTO services (
        category_id,
        title,
        slug,
        tier,
        short_description,
        description,
        price,
        price_suffix,
        duration,
        popular,
        features,
        notes,
        freebies,
        image,
        is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        category_id || null,
        cleanTitle,
        slug,
        tier || null,
        short_description?.trim() || null,
        description?.trim() || null,

        // Custom pricing = NULL
        price === null ? null : Number(price),

        price_suffix?.trim() || null,
        duration?.trim() || null,

        popular ? 1 : 0,

        JSON.stringify(cleanFeatures),
        JSON.stringify(cleanNotes),

        freebies?.trim() || null,
        image || null,

        is_active !== undefined
          ? Number(Boolean(is_active))
          : 1,
      ]
    );

    const [rows] = await pool.query(
      `${SERVICE_SELECT} WHERE s.id = ? LIMIT 1`,
      [result.insertId]
    );

    return success(
      res,
      formatService(rows[0]),
      'Service created',
      201
    );
  } catch (err) {
    console.error('[Services] Create failed:', err);

    if (err.code === 'ER_DUP_ENTRY') {
      return error(
        res,
        'A service with this title already exists',
        409
      );
    }

    next(err);
  }
}


// ============================================================
// PUT /api/services/:id
// ============================================================

async function updateService(req, res, next) {
  try {
    const { id } = req.params;

    const [existingRows] = await pool.query(
      'SELECT * FROM services WHERE id = ? LIMIT 1',
      [id]
    );

    const existing = existingRows[0];

    if (!existing) {
      return error(res, 'Service not found', 404);
    }

    const {
      title,
      category_id,
      tier,
      short_description,
      description,
      price,
      price_suffix,
      duration,
      popular,
      features,
      notes,
      freebies,
      image,
      is_active,
    } = req.body;

    // ----------------------------------------------------------
    // Validation
    // ----------------------------------------------------------

    if (title !== undefined && !String(title).trim()) {
      return error(res, 'Service title cannot be empty', 422);
    }

    if (
      price !== undefined &&
      price !== null &&
      (isNaN(price) || Number(price) < 0)
    ) {
      return error(
        res,
        'Price must be a valid positive number or null',
        422
      );
    }

    // ----------------------------------------------------------
    // Slug
    // ----------------------------------------------------------

    const cleanTitle =
      title !== undefined
        ? String(title).trim()
        : existing.title;

    const slug =
      title !== undefined
        ? slugify(cleanTitle)
        : existing.slug;

    // ----------------------------------------------------------
    // Check duplicate slug
    // ----------------------------------------------------------

    if (title !== undefined) {
      const [duplicateRows] = await pool.query(
        `
        SELECT id
        FROM services
        WHERE slug = ?
        AND id != ?
        LIMIT 1
        `,
        [slug, id]
      );

      if (duplicateRows.length > 0) {
        return error(
          res,
          'Another service with this title already exists',
          409
        );
      }
    }

    // ----------------------------------------------------------
    // Preserve existing JSON data when not supplied
    // ----------------------------------------------------------

    const finalFeatures =
      features !== undefined
        ? Array.isArray(features)
          ? features.filter(Boolean)
          : []
        : parseJson(existing.features, []);

    const finalNotes =
      notes !== undefined
        ? Array.isArray(notes)
          ? notes.filter(Boolean)
          : []
        : parseJson(existing.notes, []);

    // ----------------------------------------------------------
    // Update
    // ----------------------------------------------------------

    await pool.query(
      `
      UPDATE services
      SET
        category_id = ?,
        title = ?,
        slug = ?,
        tier = ?,
        short_description = ?,
        description = ?,
        price = ?,
        price_suffix = ?,
        duration = ?,
        popular = ?,
        features = ?,
        notes = ?,
        freebies = ?,
        image = ?,
        is_active = ?
      WHERE id = ?
      `,
      [
        category_id !== undefined
          ? category_id || null
          : existing.category_id,

        cleanTitle,
        slug,

        tier !== undefined
          ? tier?.trim() || null
          : existing.tier,

        short_description !== undefined
          ? short_description?.trim() || null
          : existing.short_description,

        description !== undefined
          ? description?.trim() || null
          : existing.description,

        price !== undefined
          ? price === null
            ? null
            : Number(price)
          : existing.price,

        price_suffix !== undefined
          ? price_suffix?.trim() || null
          : existing.price_suffix,

        duration !== undefined
          ? duration?.trim() || null
          : existing.duration,

        popular !== undefined
          ? Number(Boolean(popular))
          : existing.popular,

        JSON.stringify(finalFeatures),
        JSON.stringify(finalNotes),

        freebies !== undefined
          ? freebies?.trim() || null
          : existing.freebies,

        image !== undefined
          ? image || null
          : existing.image,

        is_active !== undefined
          ? Number(Boolean(is_active))
          : existing.is_active,

        id,
      ]
    );

    const [rows] = await pool.query(
      `${SERVICE_SELECT} WHERE s.id = ? LIMIT 1`,
      [id]
    );

    return success(
      res,
      formatService(rows[0]),
      'Service updated'
    );
  } catch (err) {
    console.error('[Services] Update failed:', err);

    if (err.code === 'ER_DUP_ENTRY') {
      return error(
        res,
        'A service with this title already exists',
        409
      );
    }

    next(err);
  }
}


// ============================================================
// DELETE /api/services/:id
// ============================================================

async function deleteService(req, res, next) {
  try {
    const { id } = req.params;

    // Check whether orders already reference this service
    const [orderRows] = await pool.query(
      `
      SELECT COUNT(*) AS cnt
      FROM orders
      WHERE service_id = ?
      `,
      [id]
    );

    const hasOrders = Number(orderRows[0].cnt) > 0;

    if (hasOrders) {
      const [result] = await pool.query(
        `
        UPDATE services
        SET is_active = 0
        WHERE id = ?
        `,
        [id]
      );

      if (result.affectedRows === 0) {
        return error(res, 'Service not found', 404);
      }

      return success(
        res,
        null,
        'Service has existing orders — deactivated instead of deleted'
      );
    }

    const [result] = await pool.query(
      'DELETE FROM services WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return error(res, 'Service not found', 404);
    }

    return success(
      res,
      null,
      'Service deleted'
    );
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