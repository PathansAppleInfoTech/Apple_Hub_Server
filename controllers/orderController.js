const { pool } = require('../config/db');
const { success, error } = require('../utils/apiResponse');
const { generateOrderNumber } = require('../utils/generateOrderNumber');

const ORDER_SELECT = `
  SELECT o.*, a.name AS assigned_to_name
  FROM orders o
  LEFT JOIN admins a ON a.id = o.assigned_to
`;

// POST /api/orders  (public — customer checkout)
// Creates the order in "pending" state. Payment is confirmed separately
// via /api/payments/create + /api/payments/webhook — a frontend redirect
// alone never marks an order as paid.
async function createOrder(req, res, next) {
  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      service_id,
    } = req.body;

    if (!customer_name || !customer_email || !customer_phone || !service_id) {
      return error(res, 'Name, email, phone and service are required', 422);
    }

    const [serviceRows] = await pool.query(
      'SELECT id, title, price FROM services WHERE id = ? AND is_active = 1',
      [service_id]
    );
    const service = serviceRows[0];
    if (!service) return error(res, 'Selected service is not available', 404);

    const orderNumber = generateOrderNumber();

    const [result] = await pool.query(
      `INSERT INTO orders
        (order_number, customer_name, customer_email, customer_phone, customer_address,
         service_id, service_title, amount, payment_status, order_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending')`,
      [
        orderNumber,
        customer_name,
        customer_email,
        customer_phone,
        customer_address || null,
        service.id,
        service.title,
        service.price,
      ]
    );

    const [rows] = await pool.query(`${ORDER_SELECT} WHERE o.id = ?`, [result.insertId]);
    return success(res, rows[0], 'Order created', 201);
  } catch (err) {
    next(err);
  }
}

// GET /api/orders/:id  (public — order confirmation lookup, accepts id or order_number)
async function getOrder(req, res, next) {
  try {
    const { id } = req.params;
    const isNumeric = /^\d+$/.test(id);
    const sql = `${ORDER_SELECT} WHERE ${isNumeric ? 'o.id = ?' : 'o.order_number = ?'} LIMIT 1`;
    const [rows] = await pool.query(sql, [id]);
    if (!rows[0]) return error(res, 'Order not found', 404);
    return success(res, rows[0]);
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/orders  (admin — all orders, staff — only assigned)
async function listOrders(req, res, next) {
  try {
    const { status, payment_status, search } = req.query;
    const clauses = [];
    const params = [];

    // Staff can only see their own assigned orders; admins see everything.
    if (req.admin.role === 'staff') {
      clauses.push('o.assigned_to = ?');
      params.push(req.admin.id);
    }
    if (status) {
      clauses.push('o.order_status = ?');
      params.push(status);
    }
    if (payment_status) {
      clauses.push('o.payment_status = ?');
      params.push(payment_status);
    }
    if (search) {
      clauses.push('(o.order_number LIKE ? OR o.customer_name LIKE ? OR o.customer_email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `${ORDER_SELECT} ${where} ORDER BY o.created_at DESC`;
    const [rows] = await pool.query(sql, params);
    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// GET /api/admin/orders/:id (admin/staff detail view)
async function getOrderDetail(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`${ORDER_SELECT} WHERE o.id = ?`, [id]);
    const order = rows[0];
    if (!order) return error(res, 'Order not found', 404);

    if (req.admin.role === 'staff' && order.assigned_to !== req.admin.id) {
      return error(res, 'You do not have access to this order', 403);
    }

    const [payments] = await pool.query('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC', [id]);
    return success(res, { ...order, payments });
  } catch (err) {
    next(err);
  }
}

const VALID_ORDER_STATUSES = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'];

// PUT /api/admin/orders/:id/status
async function updateOrderStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { order_status } = req.body;

    if (!VALID_ORDER_STATUSES.includes(order_status)) {
      return error(res, `order_status must be one of: ${VALID_ORDER_STATUSES.join(', ')}`, 422);
    }

    const [result] = await pool.query('UPDATE orders SET order_status = ? WHERE id = ?', [order_status, id]);
    if (result.affectedRows === 0) return error(res, 'Order not found', 404);

    const [rows] = await pool.query(`${ORDER_SELECT} WHERE o.id = ?`, [id]);
    return success(res, rows[0], 'Order status updated');
  } catch (err) {
    next(err);
  }
}

// PUT /api/admin/orders/:id/assign
async function assignOrder(req, res, next) {
  try {
    const { id } = req.params;
    const { assigned_to } = req.body; // admin id, or null to unassign

    if (assigned_to) {
      const [staffRows] = await pool.query('SELECT id FROM admins WHERE id = ? AND is_active = 1', [assigned_to]);
      if (!staffRows[0]) return error(res, 'Selected staff member not found', 404);
    }

    const [result] = await pool.query('UPDATE orders SET assigned_to = ? WHERE id = ?', [assigned_to || null, id]);
    if (result.affectedRows === 0) return error(res, 'Order not found', 404);

    const [rows] = await pool.query(`${ORDER_SELECT} WHERE o.id = ?`, [id]);
    return success(res, rows[0], 'Order assignment updated');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createOrder,
  getOrder,
  listOrders,
  getOrderDetail,
  updateOrderStatus,
  assignOrder,
};
