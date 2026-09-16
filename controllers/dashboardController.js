const { pool } = require('../config/db');
const { success } = require('../utils/apiResponse');

// GET /api/admin/dashboard
async function getDashboardStats(req, res, next) {
  try {
    // Admin can see everything.
    // Executive and Technical can see only their assigned orders.
    const restrictedScope = ['executive', 'technical'].includes(
      req.admin.role
    );

    const scopeClause = restrictedScope
      ? 'WHERE assigned_to = ?'
      : '';

    const scopeParams = restrictedScope
      ? [req.admin.id]
      : [];

    // Total active services
    const [[serviceCount]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM services
        WHERE is_active = 1
  `
    );

    // Total active categories
    const [[categoryCount]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM categories
        WHERE is_active = 1
  `
    );

    // Total orders
    const [[orderCount]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM orders
        ${ scopeClause }
`,
      scopeParams
    );

    // Total revenue from paid orders
    const [[revenue]] = await pool.query(
      `
        SELECT COALESCE(SUM(amount), 0) AS total
        FROM orders
        ${
  scopeClause
    ? `${scopeClause} AND`
    : 'WHERE'
}
payment_status = 'paid'
  `,
      scopeParams
    );

    // Recent orders
    const [recentOrders] = await pool.query(
      `
SELECT
o.*,
  a.name AS assigned_to_name
        FROM orders o
        LEFT JOIN admins a
          ON a.id = o.assigned_to
        ${
  restrictedScope
    ? 'WHERE o.assigned_to = ?'
    : ''
}
        ORDER BY o.created_at DESC
        LIMIT 8
  `,
      scopeParams
    );

    // Order status distribution
    const [statusSummary] = await pool.query(
      `
SELECT
order_status,
  COUNT(*) AS total
        FROM orders
        ${ scopeClause }
        GROUP BY order_status
  `,
      scopeParams
    );

    return success(res, {
      totalServices: Number(serviceCount.total || 0),
      totalCategories: Number(categoryCount.total || 0),
      totalOrders: Number(orderCount.total || 0),
      revenue: Number(revenue.total || 0),

      recentOrders,
      statusSummary,
    });
  } catch (err) {
    console.error(
      '[admin/dashboard] Failed to load dashboard stats:',
      err
    );

    next(err);
  }
}


module.exports = {
  getDashboardStats,
};