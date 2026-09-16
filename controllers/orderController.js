const { pool } = require('../config/db');
const { success, error } = require('../utils/apiResponse');
const { generateOrderNumber } = require('../utils/generateOrderNumber');
const { getNextStaffForOrder } = require('../utils/getNextStaff');
const { sendOrderConfirmationEmail } = require('../utils/mailer');

const ORDER_SELECT = `
  SELECT
    o.*,
    a.name AS assigned_to_name
  FROM orders o
  LEFT JOIN admins a ON a.id = o.assigned_to
`;

const VALID_ORDER_STATUSES = [
  'confirmed',
  'processing',
  'completed',
  'refunded',
];

// POST /api/orders
// Public — customer checkout
async function createOrder(req, res, next) {
  const connection =
    await pool.getConnection();

  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      service_id,
    } = req.body;

    const name =
      String(customer_name || '').trim();

    const email =
      String(customer_email || '')
        .trim()
        .toLowerCase();

    const phone =
      String(customer_phone || '').trim();

    const address =
      String(customer_address || '').trim();

    /*
     * --------------------------------------------------
     * Payment must already be verified.
     *
     * This prevents someone from directly calling
     * POST /api/orders and creating a paid order.
     * --------------------------------------------------
     */
    const verifiedPayment =
      req.verifiedPayment;

    const verifiedService =
      req.verifiedService;

    if (
      !verifiedPayment ||
      !verifiedPayment.razorpay_order_id ||
      !verifiedPayment.razorpay_payment_id
    ) {
      return error(
        res,
        'A verified payment is required to create an order',
        403
      );
    }

    /*
     * --------------------------------------------------
     * Basic customer validation
     * --------------------------------------------------
     */
    if (
      !name ||
      !email ||
      !phone ||
      !service_id
    ) {
      return error(
        res,
        'Name, email, phone and service are required',
        422
      );
    }

    const emailRegex =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
      return error(
        res,
        'Please enter a valid email address',
        422
      );
    }

    if (
      name.length < 2 ||
      name.length > 120
    ) {
      return error(
        res,
        'Please enter a valid name',
        422
      );
    }

    if (
      phone.length < 7 ||
      phone.length > 20
    ) {
      return error(
        res,
        'Please enter a valid phone number',
        422
      );
    }

    /*
     * --------------------------------------------------
     * Start transaction
     * --------------------------------------------------
     */
    await connection.beginTransaction();

    /*
     * --------------------------------------------------
     * Get and lock the service.
     *
     * Even though verifyPayment already checked it,
     * we check again inside the order transaction.
     * --------------------------------------------------
     */
    const [serviceRows] =
      await connection.query(
        `
          SELECT
            id,
            title,
            price
          FROM services
          WHERE id = ?
            AND is_active = 1
          FOR UPDATE
        `,
        [service_id]
      );

    const service =
      serviceRows[0];

    if (!service) {
      await connection.rollback();

      return error(
        res,
        'Selected service is no longer available',
        404
      );
    }

    /*
     * Make sure the price has not changed between
     * payment verification and order creation.
     */
    const verifiedAmount =
      Number(
        verifiedPayment.amount
      );

    const currentServiceAmount =
      Number(service.price);

    if (
      verifiedAmount !==
      currentServiceAmount
    ) {
      await connection.rollback();

      console.error(
        `[order] Price changed after payment verification | payment=${verifiedPayment.razorpay_payment_id}`
      );

      return error(
        res,
        'Service price changed. Please contact support.',
        409
      );
    }

    /*
     * --------------------------------------------------
     * Prevent duplicate order creation
     * --------------------------------------------------
     *
     * This is important if the frontend retries the
     * verification request.
     *
     * We use Razorpay payment ID as the unique reference.
     */
    const [
      existingOrderRows
    ] = await connection.query(
      `
        SELECT
          id,
          order_number
        FROM orders
        WHERE razorpay_payment_id = ?
        LIMIT 1
      `,
      [
        verifiedPayment.razorpay_payment_id
      ]
    );

    if (
      existingOrderRows.length > 0
    ) {
      await connection.rollback();

      const existingOrder =
        existingOrderRows[0];

      /*
       * Fetch the complete existing order.
       */
      const [existingRows] =
        await pool.query(
          `
            ${ORDER_SELECT}
            WHERE o.id = ?
            LIMIT 1
          `,
          [existingOrder.id]
        );

      return success(
        res,
        existingRows[0],
        'Order already exists for this payment',
        200
      );
    }

    /*
     * --------------------------------------------------
     * Automatically assign staff
     * --------------------------------------------------
     */
    const assignedStaff =
      await getNextStaffForOrder(
        connection
      );

    /*
     * --------------------------------------------------
     * Generate internal order number
     * --------------------------------------------------
     */
    const orderNumber =
      generateOrderNumber();

    /*
     * --------------------------------------------------
     * Create the actual order.
     *
     * IMPORTANT:
     *
     * This is the ONLY place where the orders table
     * gets a new customer order.
     *
     * It happens AFTER Razorpay verification.
     * --------------------------------------------------
     */
    const [result] =
      await connection.query(
        `
          INSERT INTO orders
          (
            order_number,
            customer_name,
            customer_email,
            customer_phone,
            customer_address,
            service_id,
            service_title,
            amount,

            razorpay_order_id,
            razorpay_payment_id,

            assigned_to,
            payment_status,
            order_status
          )
          VALUES
          (
            ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?,
            ?, 'paid', 'confirmed'
          )
        `,
        [
          orderNumber,

          name,
          email,
          phone,
          address || null,

          service.id,
          service.title,
          service.price,

          verifiedPayment.razorpay_order_id,
          verifiedPayment.razorpay_payment_id,

          assignedStaff?.id || null,
        ]
      );

    /*
     * --------------------------------------------------
     * Commit transaction
     * --------------------------------------------------
     */
    await connection.commit();

    /*
     * --------------------------------------------------
     * Fetch complete order
     * --------------------------------------------------
     */
    const [rows] =
      await pool.query(
        `
          ${ORDER_SELECT}
          WHERE o.id = ?
          LIMIT 1
        `,
        [result.insertId]
      );

    const createdOrder =
      rows[0];

    console.log(
      `[order] CREATED | order=${orderNumber} | payment=${verifiedPayment.razorpay_payment_id} | razorpay_order=${verifiedPayment.razorpay_order_id} | assigned=${assignedStaff?.name || 'unassigned'} `
    );

    /*
     * --------------------------------------------------
     * Send customer confirmation email
     * --------------------------------------------------
     *
     * IMPORTANT:
     * The database transaction has already been
     * committed at this point.
     *
     * Therefore an email failure must NOT cause the
     * successfully created order to fail.
     * --------------------------------------------------
     */
    try {
      await sendOrderConfirmationEmail(
        createdOrder
      );

      console.log(
        `[order] Confirmation email sent | order=${orderNumber} | email=${email} `
      );
    } catch (emailError) {
      console.error(
        `[order] Order created but confirmation email failed | order=${orderNumber} | email=${email} `,
        emailError
      );
    }

    return success(
      res,
      createdOrder,
      'Payment verified and order created',
      201
    );


  } catch (err) {
    try {
      await connection.rollback();
    } catch (_) { }

    /*
     * Duplicate payment ID can happen if two
     * verification requests arrive simultaneously.
     */
    if (
      err.code ===
      'ER_DUP_ENTRY'
    ) {
      try {
        const [
          existingRows
        ] = await pool.query(
          `
            SELECT id
            FROM orders
            WHERE razorpay_payment_id = ?
            LIMIT 1
          `,
          [
            req.verifiedPayment
              ?.razorpay_payment_id
          ]
        );

        if (
          existingRows.length > 0
        ) {
          const [
            rows
          ] = await pool.query(
            `
              ${ORDER_SELECT}
              WHERE o.id = ?
              LIMIT 1
            `,
            [existingRows[0].id]
          );

          return success(
            res,
            rows[0],
            'Order already exists for this payment',
            200
          );
        }
      } catch (duplicateLookupError) {
        console.error(
          '[order] Duplicate lookup failed:',
          duplicateLookupError
        );
      }
    }

    console.error(
      '[order] Creation error:',
      err
    );

    next(err);
  } finally {
    connection.release();
  }
}

// GET /api/orders/:id
// Public — order confirmation lookup
async function getOrder(req, res, next) {
  try {
    const { id } = req.params;

    const isNumeric = /^\d+$/.test(id);

    const sql = `
      ${ORDER_SELECT}
      WHERE ${isNumeric
        ? 'o.id = ?'
        : 'o.order_number = ?'
      }
      LIMIT 1
    `;

    const [rows] = await pool.query(sql, [id]);

    if (!rows[0]) {
      return error(
        res,
        'Order not found',
        404
      );
    }

    return success(res, rows[0]);
  } catch (err) {
    next(err);
  }
}


// GET /api/admin/orders
// Admin — all orders
// Staff — only assigned orders
async function listOrders(req, res, next) {
  try {
    const {
      status,
      payment_status,
      search,
    } = req.query;

    const clauses = [];
    const params = [];

    if (req.admin.role === 'staff') {
      clauses.push('o.assigned_to = ?');
      params.push(req.admin.id);
    }

    if (status) {
      if (!VALID_ORDER_STATUSES.includes(status)) {
        return error(
          res,
          'Invalid order status',
          422
        );
      }

      clauses.push('o.order_status = ?');
      params.push(status);
    }

    if (payment_status) {
      const validPaymentStatuses = [
        'pending',
        'paid',
        'failed',
        'refunded',
      ];

      if (!validPaymentStatuses.includes(payment_status)) {
        return error(
          res,
          'Invalid payment status',
          422
        );
      }

      clauses.push('o.payment_status = ?');
      params.push(payment_status);
    }

    if (search) {
      const searchTerm = String(search).trim();

      if (searchTerm) {
        clauses.push(`
          (
            o.order_number LIKE ?
            OR o.customer_name LIKE ?
            OR o.customer_email LIKE ?
            OR o.customer_phone LIKE ?
          )
        `);

        const value = `%${searchTerm}%`;

        params.push(
          value,
          value,
          value,
          value
        );
      }
    }

    const where = clauses.length
      ? `WHERE ${clauses.join(' AND ')}`
      : '';

    const sql = `
      ${ORDER_SELECT}
      ${where}
      ORDER BY o.created_at DESC
    `;

    const [rows] = await pool.query(
      sql,
      params
    );

    return success(res, rows);
  } catch (err) {
    next(err);
  }
}


// GET /api/admin/orders/:id
async function getOrderDetail(req, res, next) {
  try {
    const { id } = req.params;

    /*
     * --------------------------------------------------
     * Get order
     * --------------------------------------------------
     */
    const [rows] = await pool.query(
      `
        ${ORDER_SELECT}
        WHERE o.id = ?
        LIMIT 1
      `,
      [id]
    );

    const order = rows[0];

    if (!order) {
      return error(
        res,
        'Order not found',
        404
      );
    }

    /*
     * --------------------------------------------------
     * Staff access restriction
     * --------------------------------------------------
     *
     * Admins can view every order.
     *
     * Staff can only view orders automatically
     * assigned to them.
     * --------------------------------------------------
     */
    if (
      req.admin.role === 'staff' &&
      Number(order.assigned_to) !==
        Number(req.admin.id)
    ) {
      return error(
        res,
        'You do not have access to this order',
        403
      );
    }

    /*
     * --------------------------------------------------
     * Payment information is now stored directly
     * in the orders table.
     *
     * No payments table is used anymore.
     * --------------------------------------------------
     */

    return success(res, order);

  } catch (err) {
    console.error(
      '[admin/orders] Failed to get order detail:',
      err
    );

    next(err);
  }
}



// PUT /api/admin/orders/:id/status
async function updateOrderStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { order_status } = req.body;

    if (!VALID_ORDER_STATUSES.includes(order_status)) {
      return error(
        res,
        `order_status must be one of: ${VALID_ORDER_STATUSES.join(
          ', '
        )}`,
        422
      );
    }

    const [existingRows] = await pool.query(
      `
        SELECT
          id,
          payment_status,
          order_status,
          assigned_to
        FROM orders
        WHERE id = ?
        LIMIT 1
      `,
      [id]
    );

    const order = existingRows[0];

    if (!order) {
      return error(
        res,
        'Order not found',
        404
      );
    }

    if (
      req.admin.role === 'staff' &&
      Number(order.assigned_to) !== Number(req.admin.id)
    ) {
      return error(
        res,
        'You do not have access to this order',
        403
      );
    }

    /*
     * Do not allow an unpaid order to be manually
     * marked as completed.
     */
    if (
      order_status === 'completed' &&
      order.payment_status !== 'paid'
    ) {
      return error(
        res,
        'An order must be paid before it can be completed',
        422
      );
    }

    await pool.query(
      `
        UPDATE orders
        SET order_status = ?
        WHERE id = ?
      `,
      [order_status, id]
    );

    const [rows] = await pool.query(
      `
        ${ORDER_SELECT}
        WHERE o.id = ?
        LIMIT 1
      `,
      [id]
    );

    return success(
      res,
      rows[0],
      'Order status updated'
    );
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
};