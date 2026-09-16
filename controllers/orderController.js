const { pool } = require('../config/db');
const { success, error } = require('../utils/apiResponse');
const { generateOrderNumber } = require('../utils/generateOrderNumber');
const { getNextStaffForOrder } = require('../utils/getNextStaff');
const { sendOrderConfirmationEmail } = require('../utils/mailer');


/*
|--------------------------------------------------------------------------
| ORDER SELECT
|--------------------------------------------------------------------------
|
| Make sure your orders table has:
|
| assigned_executive INT UNSIGNED NULL
| assigned_technical INT UNSIGNED NULL
|
*/

const ORDER_SELECT = `
  SELECT
    o.*,


    s.title AS service_title,

    ae.name AS assigned_executive_name,
    ae.email AS assigned_executive_email,

    at.name AS assigned_technical_name,
    at.email AS assigned_technical_email

  FROM orders o

  LEFT JOIN services s
    ON s.id = o.service_id

  LEFT JOIN admins ae
    ON ae.id = o.assigned_executive

  LEFT JOIN admins at
    ON at.id = o.assigned_technical
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
  const connection = await pool.getConnection();

  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      service_id,
    } = req.body;

    const name = String(customer_name || '').trim();

    const email = String(customer_email || '')
      .trim()
      .toLowerCase();

    const phone = String(customer_phone || '').trim();

    const address = String(customer_address || '').trim();

    /*
     * --------------------------------------------------
     * Payment must already be verified.
     *
     * This prevents someone from directly calling
     * POST /api/orders and creating a paid order.
     * --------------------------------------------------
     */
    const verifiedPayment = req.verifiedPayment;

    const verifiedService = req.verifiedService;

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
     * check it again inside the order transaction.
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
          LIMIT 1
          FOR UPDATE
  `,
        [service_id]
      );

    const service = serviceRows[0];

    if (!service) {
      await connection.rollback();

      return error(
        res,
        'Selected service is no longer available',
        404
      );
    }

    /*
     * --------------------------------------------------
     * Make sure the price has not changed between
     * payment verification and order creation.
     * --------------------------------------------------
     */
    const verifiedAmount =
      Number(verifiedPayment.amount);

    const currentServiceAmount =
      Number(service.price);

    if (
      verifiedAmount !==
      currentServiceAmount
    ) {
      await connection.rollback();

      console.error(
        `[order] Price changed after payment verification | payment=${verifiedPayment.razorpay_payment_id} `
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
     */
    const [
      existingOrderRows,
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
        verifiedPayment.razorpay_payment_id,
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
      const [
        existingRows,
      ] = await pool.query(
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
     * NO AUTOMATIC ASSIGNMENT
     *
     * New orders start with:
     *
     * assigned_executive = NULL
     * assigned_technical = NULL
     *
     * They will be assigned later from the admin panel.
     * --------------------------------------------------
     */

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

    assigned_executive,
    assigned_technical,

    payment_status,
    order_status
  )
VALUES
  (
            ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?,
    NULL,
    NULL,
    'paid',
    'confirmed'
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
      `[order] CREATED | order=${orderNumber} | payment=${verifiedPayment.razorpay_payment_id} | razorpay_order=${verifiedPayment.razorpay_order_id} | executive=unassigned | technical=unassigned`
    );

    /*
     * --------------------------------------------------
     * Send customer confirmation email
     * --------------------------------------------------
     *
     * Database transaction has already been committed.
     * Email failure must NOT fail the order.
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
      err.code === 'ER_DUP_ENTRY'
    ) {
      try {
        const [
          existingRows,
        ] = await pool.query(
          `
SELECT
id
            FROM orders
            WHERE razorpay_payment_id = ?
  LIMIT 1
    `,
          [
            req.verifiedPayment
              ?.razorpay_payment_id,
          ]
        );

        if (
          existingRows.length > 0
        ) {
          const [
            rows,
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



/*
|--------------------------------------------------------------------------
| GET /api/admin/orders
|--------------------------------------------------------------------------
|
| ADMIN:
|   Sees every order.
|
| EXECUTIVE:
|   Sees orders assigned to them OR orders with no Executive.
|
| TECHNICAL:
|   Sees orders assigned to them OR orders with no Technical.
|
*/

async function listOrders(req, res, next) {
  try {
    const {
      status,
      payment_status,
      search,
    } = req.query;

    const clauses = [];
    const params = [];

    /*
     * --------------------------------------------------
     * ROLE BASED ORDER VISIBILITY
     * --------------------------------------------------
     */

    if (req.admin.role === 'executive') {
      clauses.push(`
        (
          o.assigned_executive = ?
          OR o.assigned_executive IS NULL
        )
      `);

      params.push(req.admin.id);
    }

    if (req.admin.role === 'technical') {
      clauses.push(`
        (
          o.assigned_technical = ?
          OR o.assigned_technical IS NULL
        )
      `);

      params.push(req.admin.id);
    }

    /*
     * --------------------------------------------------
     * ORDER STATUS FILTER
     * --------------------------------------------------
     */

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

    /*
     * --------------------------------------------------
     * PAYMENT STATUS FILTER
     * --------------------------------------------------
     */

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

    /*
     * --------------------------------------------------
     * SEARCH
     * --------------------------------------------------
     */

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


/*
|--------------------------------------------------------------------------
| GET /api/admin/orders/:id
|--------------------------------------------------------------------------
|
| ADMIN:
|   Can view every order.
|
| EXECUTIVE:
|   Can view if:
|     - assigned to them
|     - OR Executive slot is unassigned
|
| TECHNICAL:
|   Can view if:
|     - assigned to them
|     - OR Technical slot is unassigned
|
*/

async function getOrderDetail(req, res, next) {
  try {
    const { id } = req.params;

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
     * ACCESS CONTROL
     * --------------------------------------------------
     */

    if (req.admin.role === 'executive') {
      const assignedExecutive =
        Number(order.assigned_executive);

      const myId = Number(req.admin.id);

      if (
        assignedExecutive !== 0 &&
        !Number.isNaN(assignedExecutive) &&
        assignedExecutive !== myId
      ) {
        return error(
          res,
          'You do not have access to this order',
          403
        );
      }
    }

    if (req.admin.role === 'technical') {
      const assignedTechnical =
        Number(order.assigned_technical);

      const myId = Number(req.admin.id);

      if (
        assignedTechnical !== 0 &&
        !Number.isNaN(assignedTechnical) &&
        assignedTechnical !== myId
      ) {
        return error(
          res,
          'You do not have access to this order',
          403
        );
      }
    }

    return success(res, order);

  } catch (err) {
    console.error(
      '[admin/orders] Failed to get order detail:',
      err
    );

    next(err);
  }
}


/*
|--------------------------------------------------------------------------
| GET /api/admin/orders/assignable-staff
|--------------------------------------------------------------------------
|
| Used by Admin to populate the Executive and Technical
| assignment dropdowns.
|
*/

async function listAssignableStaff(req, res, next) {
  try {
    const [rows] = await pool.query(`
      SELECT
        id,
        name,
        email,
        role
      FROM admins
      WHERE role IN ('executive', 'technical')
      ORDER BY role ASC, name ASC
    `);

    return success(res, rows);

  } catch (err) {
    next(err);
  }
}


/*
|--------------------------------------------------------------------------
| PUT /api/admin/orders/:id/assign
|--------------------------------------------------------------------------
|
| ADMIN:
|   Can assign both Executive and Technical.
|
| EXECUTIVE:
|   Can ONLY claim an unassigned Executive slot for themselves.
|
| TECHNICAL:
|   Can ONLY claim an unassigned Technical slot for themselves.
|
*/

async function assignOrder(req, res, next) {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    const {
      assigned_executive,
      assigned_technical,
    } = req.body;

    /*
     * --------------------------------------------------
     * Get current order
     * --------------------------------------------------
     */

    const [orderRows] = await connection.query(
      `
        SELECT
          id,
          assigned_executive,
          assigned_technical
        FROM orders
        WHERE id = ?
        LIMIT 1
      `,
      [id]
    );

    const order = orderRows[0];

    if (!order) {
      return error(
        res,
        'Order not found',
        404
      );
    }

    /*
     * --------------------------------------------------
     * ADMIN
     * --------------------------------------------------
     *
     * Admin can assign/change either person.
     * --------------------------------------------------
     */

    if (req.admin.role === 'admin') {
      const executive =
        assigned_executive === null ||
          assigned_executive === '' ||
          typeof assigned_executive === 'undefined'
          ? null
          : Number(assigned_executive);

      const technical =
        assigned_technical === null ||
          assigned_technical === '' ||
          typeof assigned_technical === 'undefined'
          ? null
          : Number(assigned_technical);

      /*
       * Validate Executive
       */

      if (executive !== null) {
        const [executiveRows] =
          await connection.query(
            `
              SELECT id
              FROM admins
              WHERE id = ?
              AND role = 'executive'
              LIMIT 1
            `,
            [executive]
          );

        if (!executiveRows.length) {
          return error(
            res,
            'Invalid Executive selected',
            422
          );
        }
      }

      /*
       * Validate Technical
       */

      if (technical !== null) {
        const [technicalRows] =
          await connection.query(
            `
              SELECT id
              FROM admins
              WHERE id = ?
              AND role = 'technical'
              LIMIT 1
            `,
            [technical]
          );

        if (!technicalRows.length) {
          return error(
            res,
            'Invalid Technical selected',
            422
          );
        }
      }

      await connection.query(
        `
          UPDATE orders
          SET
            assigned_executive = ?,
            assigned_technical = ?
          WHERE id = ?
        `,
        [
          executive,
          technical,
          id,
        ]
      );
    }

    /*
     * --------------------------------------------------
     * EXECUTIVE
     * --------------------------------------------------
     *
     * Executive can ONLY claim themselves.
     *
     * They cannot:
     * - assign another Executive
     * - replace an existing Executive
     * - modify Technical assignment
     * --------------------------------------------------
     */

    else if (req.admin.role === 'executive') {
      const [result] = await connection.query(
        `
          UPDATE orders
          SET assigned_executive = ?
          WHERE id = ?
          AND assigned_executive IS NULL
        `,
        [
          req.admin.id,
          id,
        ]
      );

      if (result.affectedRows === 0) {
        return error(
          res,
          'This order has already been taken by another Executive',
          409
        );
      }
    }

    /*
     * --------------------------------------------------
     * TECHNICAL
     * --------------------------------------------------
     *
     * Technical can ONLY claim themselves.
     * --------------------------------------------------
     */

    else if (req.admin.role === 'technical') {
      const [result] = await connection.query(
        `
          UPDATE orders
          SET assigned_technical = ?
          WHERE id = ?
          AND assigned_technical IS NULL
        `,
        [
          req.admin.id,
          id,
        ]
      );

      if (result.affectedRows === 0) {
        return error(
          res,
          'This order has already been taken by another Technical staff member',
          409
        );
      }
    }

    else {
      return error(
        res,
        'You do not have permission to assign orders',
        403
      );
    }

    /*
     * --------------------------------------------------
     * Return updated order
     * --------------------------------------------------
     */

    const [rows] = await connection.query(
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
      'Order assignment updated'
    );

  } catch (err) {
    next(err);

  } finally {
    connection.release();
  }
}


/*
|--------------------------------------------------------------------------
| PUT /api/admin/orders/:id/status
|--------------------------------------------------------------------------
|
| ADMIN:
|   Can update any order.
|
| EXECUTIVE:
|   Can update only orders assigned to them.
|
| TECHNICAL:
|   Can update only orders assigned to them.
|
*/

async function updateOrderStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { order_status } = req.body;

    /*
     * --------------------------------------------------
     * VALIDATE STATUS
     * --------------------------------------------------
     */

    if (!VALID_ORDER_STATUSES.includes(order_status)) {
      return error(
        res,
        `order_status must be one of: ${ VALID_ORDER_STATUSES.join(', ') } `,
        422
      );
    }

    /*
     * --------------------------------------------------
     * GET ORDER
     * --------------------------------------------------
     */

    const [existingRows] = await pool.query(
      `
SELECT
id,
  payment_status,
  order_status,
  assigned_executive,
  assigned_technical
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

    /*
     * --------------------------------------------------
     * ACCESS CONTROL
     * --------------------------------------------------
     *
     * ADMIN
     * → Can update ANY order
     * → Assigned or unassigned
     *
     * EXECUTIVE
     * → Can update only orders assigned to them
     *
     * TECHNICAL
     * → Can update only orders assigned to them
     */

    if (req.admin.role === 'executive') {
      if (
        order.assigned_executive === null ||
        Number(order.assigned_executive) !== Number(req.admin.id)
      ) {
        return error(
          res,
          'You can update status only for orders assigned to you',
          403
        );
      }
    }

    if (req.admin.role === 'technical') {
      if (
        order.assigned_technical === null ||
        Number(order.assigned_technical) !== Number(req.admin.id)
      ) {
        return error(
          res,
          'You can update status only for orders assigned to you',
          403
        );
      }
    }

    /*
     * ADMIN DOES NOT NEED AN ASSIGNMENT CHECK.
     *
     * If role is admin, execution continues here
     * even when both assignments are NULL.
     */

    /*
     * --------------------------------------------------
     * PAYMENT VALIDATION
     * --------------------------------------------------
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

    /*
     * --------------------------------------------------
     * UPDATE STATUS
     * --------------------------------------------------
     */

    await pool.query(
      `
        UPDATE orders
        SET order_status = ?
  WHERE id = ?
    `,
      [
        order_status,
        id,
      ]
    );

    /*
     * --------------------------------------------------
     * GET UPDATED ORDER
     * --------------------------------------------------
     */

    const [rows] = await pool.query(
      `
        ${ ORDER_SELECT }
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
  listAssignableStaff,
  assignOrder
};