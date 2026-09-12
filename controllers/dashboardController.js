const { pool } = require('../config/db');
const { success } = require('../utils/apiResponse');

// GET /api/admin/dashboard
async function getDashboardStats(req, res, next) {
  try {
    const staffScope = req.admin.role === 'staff';
    const scopeClause = staffScope ? 'WHERE assigned_to = ?' : '';
    const scopeParams = staffScope ? [req.admin.id] : [];

    const [[serviceCount]] = await pool.query(
      'SELECT COUNT(*) AS total FROM services WHERE is_active = 1'
    );
    const [[orderCount]] = await pool.query(
      `SELECT COUNT(*) AS total FROM orders ${scopeClause}`,
      scopeParams
    );
    const [[pendingCount]] = await pool.query(
      `SELECT COUNT(*) AS total FROM orders ${scopeClause ? scopeClause + ' AND' : 'WHERE'} order_status = 'pending'`,
      scopeParams
    );
    const [[completedCount]] = await pool.query(
      `SELECT COUNT(*) AS total FROM orders ${scopeClause ? scopeClause + ' AND' : 'WHERE'} order_status = 'completed'`,
      scopeParams
    );
    const [[revenue]] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM orders ${scopeClause ? scopeClause + ' AND' : 'WHERE'} payment_status = 'paid'`,
      scopeParams
    );

    const [recentOrders] = await pool.query(
      `SELECT o.*, a.name AS assigned_to_name
       FROM orders o LEFT JOIN admins a ON a.id = o.assigned_to
       ${scopeClause}
       ORDER BY o.created_at DESC LIMIT 8`,
      scopeParams
    );

    const [statusSummary] = await pool.query(
      `SELECT order_status, COUNT(*) AS total FROM orders ${scopeClause} GROUP BY order_status`,
      scopeParams
    );

    return success(res, {
      totalServices: serviceCount.total,
      totalOrders: orderCount.total,
      pendingOrders: pendingCount.total,
      completedOrders: completedCount.total,
      revenue: Number(revenue.total),
      recentOrders,
      statusSummary,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getDashboardStats };
