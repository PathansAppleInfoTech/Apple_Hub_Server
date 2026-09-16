const { pool } = require('../config/db');
const { success } = require('../utils/apiResponse');

// GET /api/admin/dashboard
async function getDashboardStats(req, res, next) {
  try {
    /*
     * =========================================================
     * ROLE-BASED ORDER SCOPE
     * =========================================================
     *
     * Admin     -> sees all orders
     * Executive -> sees orders assigned to that executive
     * Technical -> sees orders assigned to that technical
     *
     * NOTE:
     * Unassigned orders are intentionally NOT included in the
     * dashboard statistics for Executive/Technical.
     * They can still see/take unassigned orders from Orders page.
     */

    let scopeClause = '';
    let scopeParams = [];

    if (req.admin.role === 'executive') {
      scopeClause = 'WHERE o.assigned_executive = ?';
      scopeParams = [req.admin.id];
    } else if (req.admin.role === 'technical') {
      scopeClause = 'WHERE o.assigned_technical = ?';
      scopeParams = [req.admin.id];
    }

    /*
     * =========================================================
     * TOTAL ACTIVE SERVICES
     * =========================================================
     */

    const [[serviceCount]] = await pool.query(`
      SELECT COUNT(*) AS total
      FROM services
      WHERE is_active = 1
    `);

    /*
     * =========================================================
     * TOTAL ACTIVE CATEGORIES
     * =========================================================
     */

    const [[categoryCount]] = await pool.query(`
      SELECT COUNT(*) AS total
      FROM categories
      WHERE is_active = 1
    `);

    /*
     * =========================================================
     * TOTAL ORDERS
     * =========================================================
     */

    const [[orderCount]] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM orders o
        ${scopeClause}
      `,
      scopeParams
    );

    /*
     * =========================================================
     * TOTAL REVENUE
     * =========================================================
     *
     * Only paid orders are included.
     */

    let revenueWhere = '';
    let revenueParams = [];

    if (req.admin.role === 'executive') {
      revenueWhere = `
        WHERE o.assigned_executive = ?
          AND o.payment_status = 'paid'
      `;

      revenueParams = [req.admin.id];
    } else if (req.admin.role === 'technical') {
      revenueWhere = `
        WHERE o.assigned_technical = ?
          AND o.payment_status = 'paid'
      `;

      revenueParams = [req.admin.id];
    } else {
      revenueWhere = `
        WHERE o.payment_status = 'paid'
      `;
    }

    const [[revenue]] = await pool.query(
      `
        SELECT COALESCE(SUM(o.amount), 0) AS total
        FROM orders o
        ${revenueWhere}
      `,
      revenueParams
    );

    /*
     * =========================================================
     * RECENT ORDERS
     * =========================================================
     *
     * Admin:
     *   Shows all orders.
     *
     * Executive:
     *   Shows orders assigned to that executive.
     *
     * Technical:
     *   Shows orders assigned to that technical.
     *
     * We return both assignment names because an order can have
     * both an Executive and Technical assigned.
     */

    const [recentOrders] = await pool.query(
      `
        SELECT
          o.*,

          ae.name AS assigned_executive_name,
          ae.email AS assigned_executive_email,

          at.name AS assigned_technical_name,
          at.email AS assigned_technical_email

        FROM orders o

        LEFT JOIN admins ae
          ON ae.id = o.assigned_executive

        LEFT JOIN admins at
          ON at.id = o.assigned_technical

        ${
          req.admin.role === 'executive'
            ? 'WHERE o.assigned_executive = ?'
            : req.admin.role === 'technical'
              ? 'WHERE o.assigned_technical = ?'
              : ''
        }

        ORDER BY o.created_at DESC
        LIMIT 8
      `,
      ['executive', 'technical'].includes(req.admin.role)
        ? [req.admin.id]
        : []
    );

    /*
     * =========================================================
     * ORDER STATUS DISTRIBUTION
     * =========================================================
     */

    const [statusSummary] = await pool.query(
      `
        SELECT
          o.order_status,
          COUNT(*) AS total

        FROM orders o

        ${scopeClause}

        GROUP BY o.order_status
        ORDER BY
          CASE o.order_status
            WHEN 'confirmed' THEN 1
            WHEN 'processing' THEN 2
            WHEN 'completed' THEN 3
            WHEN 'refunded' THEN 4
            ELSE 5
          END
      `,
      scopeParams
    );

    /*
     * =========================================================
     * RESPONSE
     * =========================================================
     */

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