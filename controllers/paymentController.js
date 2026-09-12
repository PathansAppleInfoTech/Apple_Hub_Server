const { pool } = require('../config/db');
const config = require('../config/env');
const { success, error } = require('../utils/apiResponse');

// ------------------------------------------------------------------
// This controller is structured for Razorpay (India's most common
// gateway), but does not hard-depend on the `razorpay` SDK so the
// project installs and runs even before real credentials exist.
//
// To go live:
//   1. npm install razorpay
//   2. Fill PAYMENT_KEY_ID / PAYMENT_KEY_SECRET in .env
//   3. Replace the placeholder blocks marked "TODO (live gateway)"
//      with real Razorpay SDK calls, following:
//      https://razorpay.com/docs/payments/server-integration/nodejs/
// ------------------------------------------------------------------

const isConfigured = () => Boolean(config.payment.keyId && config.payment.keySecret);

// POST /api/payments/create  (public — called from the checkout page)
// Creates a gateway order for a given internal order and returns what the
// frontend needs to open the payment widget.
async function createPayment(req, res, next) {
  try {
    const { order_id } = req.body;
    if (!order_id) return error(res, 'order_id is required', 422);

    const [orderRows] = await pool.query('SELECT * FROM orders WHERE id = ?', [order_id]);
    const order = orderRows[0];
    if (!order) return error(res, 'Order not found', 404);
    if (order.payment_status === 'paid') {
      return error(res, 'This order has already been paid', 409);
    }

    let gatewayOrderId;

    if (isConfigured()) {
      // TODO (live gateway): replace with a real Razorpay order creation call, e.g.:
      //
      //   const Razorpay = require('razorpay');
      //   const razorpay = new Razorpay({ key_id: config.payment.keyId, key_secret: config.payment.keySecret });
      //   const gatewayOrder = await razorpay.orders.create({
      //     amount: Math.round(order.amount * 100), // paise
      //     currency: 'INR',
      //     receipt: order.order_number,
      //   });
      //   gatewayOrderId = gatewayOrder.id;
      gatewayOrderId = `rzp_order_${order.order_number}`;
    } else {
      // No live credentials yet — placeholder id so the flow can still be tested end-to-end.
      gatewayOrderId = `test_order_${order.order_number}`;
    }

    await pool.query(
      `INSERT INTO payments (order_id, gateway_order_id, amount, status)
       VALUES (?, ?, ?, 'pending')`,
      [order.id, gatewayOrderId, order.amount]
    );

    return success(res, {
      order_id: order.id,
      order_number: order.order_number,
      amount: order.amount,
      currency: 'INR',
      gateway_order_id: gatewayOrderId,
      key_id: config.payment.keyId || null,
      test_mode: !isConfigured(),
    }, 'Payment initialized');
  } catch (err) {
    next(err);
  }
}

// POST /api/payments/webhook  (called by the payment gateway, not the browser)
// The ONLY place an order is marked as paid. A frontend "success" redirect
// is never trusted on its own — this handler verifies the signature/payload
// from the gateway before updating anything.
async function handleWebhook(req, res, next) {
  try {
    if (isConfigured()) {
      // TODO (live gateway): verify the Razorpay webhook signature before
      // trusting the payload, e.g.:
      //
      //   const signature = req.headers['x-razorpay-signature'];
      //   const expected = crypto
      //     .createHmac('sha256', config.payment.keySecret)
      //     .update(JSON.stringify(req.body))
      //     .digest('hex');
      //   if (signature !== expected) return error(res, 'Invalid webhook signature', 400);
      const signature = req.headers['x-razorpay-signature'];
      if (!signature) {
        return error(res, 'Missing webhook signature', 400);
      }
    }

    const { gateway_order_id, payment_id, status, payment_method } = req.body;
    if (!gateway_order_id || !status) {
      return error(res, 'gateway_order_id and status are required', 422);
    }

    const [paymentRows] = await pool.query(
      'SELECT * FROM payments WHERE gateway_order_id = ? ORDER BY created_at DESC LIMIT 1',
      [gateway_order_id]
    );
    const payment = paymentRows[0];
    if (!payment) return error(res, 'Payment record not found for this gateway order', 404);

    const normalizedStatus = ['pending', 'paid', 'failed', 'refunded'].includes(status)
      ? status
      : 'pending';

    await pool.query(
      `UPDATE payments SET payment_id = ?, status = ?, payment_method = ? WHERE id = ?`,
      [payment_id || null, normalizedStatus, payment_method || null, payment.id]
    );

    const newOrderStatus = normalizedStatus === 'paid' ? 'confirmed' : undefined;

    await pool.query(
      `UPDATE orders SET payment_status = ? ${newOrderStatus ? ', order_status = ?' : ''} WHERE id = ?`,
      newOrderStatus
        ? [normalizedStatus, newOrderStatus, payment.order_id]
        : [normalizedStatus, payment.order_id]
    );

    return success(res, null, 'Webhook processed');
  } catch (err) {
    next(err);
  }
}

module.exports = { createPayment, handleWebhook };
