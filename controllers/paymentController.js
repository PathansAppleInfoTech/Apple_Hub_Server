const crypto = require('crypto');
const Razorpay = require('razorpay');

const { pool } = require('../config/db');
const config = require('../config/env');
const { success, error } = require('../utils/apiResponse');
const { generateOrderNumber } = require('../utils/generateOrderNumber');
const { getNextStaffForOrder } = require('../utils/getNextStaff');
const { createOrder } = require('./orderController');

const isConfigured = () =>
  Boolean(
    config.payment.keyId &&
    config.payment.keySecret
  );

let razorpay = null;

if (isConfigured()) {
  razorpay = new Razorpay({
    key_id: config.payment.keyId,
    key_secret: config.payment.keySecret,
  });
}

const ORDER_SELECT = `
  SELECT
    o.*,
    a.name AS assigned_to_name
  FROM orders o
  LEFT JOIN admins a ON a.id = o.assigned_to
`;

/**
 * POST /api/payments/create
 *
 * Creates a Razorpay order for an internal order.
 */
async function createPayment(req, res, next) {
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

    if (!name || !email || !phone || !service_id) {
      return error(
        res,
        'Name, email, phone and service are required',
        422
      );
    }

    if (!config.payment.keyId || !config.payment.keySecret) {
      return error(
        res,
        'Payment gateway is not configured',
        503
      );
    }

    /*
     * Get the service directly from DB.
     *
     * NEVER trust price sent by frontend.
     */
    const [serviceRows] = await pool.query(
      `
        SELECT
          id,
          title,
          price
        FROM services
        WHERE id = ?
          AND is_active = 1
        LIMIT 1
      `,
      [service_id]
    );

    const service = serviceRows[0];

    if (!service) {
      return error(
        res,
        'Selected service is not available',
        404
      );
    }

    if (
      service.price === null ||
      Number(service.price) <= 0
    ) {
      return error(
        res,
        'This service cannot be purchased online',
        422
      );
    }

    /*
     * Create Razorpay order ONLY.
     *
     * No internal `orders` row is created here.
     */
    const gatewayOrder =
      await razorpay.orders.create({
        amount: Math.round(
          Number(service.price) * 100
        ),

        currency: 'INR',

        receipt: `PAY-${Date.now()}`,

        notes: {
          service_id: String(service.id),
          service_title: service.title,
          customer_email: email,
        },
      });

    return success(
      res,
      {
        amount: service.price,
        currency: 'INR',

        gateway_order_id:
          gatewayOrder.id,

        key_id:
          config.payment.keyId,

        service_id:
          service.id,

        service_title:
          service.title,
      },
      'Payment initialized'
    );
  } catch (err) {
    console.error(
      '[payment] create error:',
      err
    );

    next(err);
  }
}

async function verifyPayment(req, res, next) {
  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      customer_address,
      service_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    /*
     * Basic verification input validation.
     */
    if (
      !customer_name ||
      !customer_email ||
      !customer_phone ||
      !service_id ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return error(
        res,
        'Payment verification data is incomplete',
        422
      );
    }

    /*
     * Make sure Razorpay is configured.
     */
    if (
      !config.payment.keyId ||
      !config.payment.keySecret
    ) {
      return error(
        res,
        'Payment gateway is not configured',
        503
      );
    }

    /*
     * --------------------------------------------------
     * 1. Verify Razorpay signature
     * --------------------------------------------------
     */
    const generatedSignature = crypto
      .createHmac(
        'sha256',
        config.payment.keySecret
      )
      .update(
        `${razorpay_order_id}|${razorpay_payment_id}`
      )
      .digest('hex');

    const signatureBuffer =
      Buffer.from(generatedSignature);

    const receivedSignatureBuffer =
      Buffer.from(razorpay_signature);

    if (
      signatureBuffer.length !==
      receivedSignatureBuffer.length ||
      !crypto.timingSafeEqual(
        signatureBuffer,
        receivedSignatureBuffer
      )
    ) {
      return error(
        res,
        'Invalid payment signature',
        400
      );
    }

    /*
     * --------------------------------------------------
     * 2. Fetch actual payment from Razorpay
     * --------------------------------------------------
     *
     * Never trust payment status/amount
     * directly from the frontend.
     */
    const razorpayPayment =
      await razorpay.payments.fetch(
        razorpay_payment_id
      );

    /*
     * --------------------------------------------------
     * 3. Verify payment belongs to this Razorpay order
     * --------------------------------------------------
     */
    if (
      razorpayPayment.order_id !==
      razorpay_order_id
    ) {
      return error(
        res,
        'Payment order mismatch',
        400
      );
    }

    /*
     * --------------------------------------------------
     * 4. Verify service and amount
     * --------------------------------------------------
     *
     * We get the price from OUR database.
     */
    const [serviceRows] = await pool.query(
      `
        SELECT
          id,
          title,
          price
        FROM services
        WHERE id = ?
          AND is_active = 1
        LIMIT 1
      `,
      [service_id]
    );

    const service = serviceRows[0];

    if (!service) {
      return error(
        res,
        'Selected service is no longer available',
        404
      );
    }

    /*
     * This service must have a valid online price.
     */
    if (
      service.price === null ||
      Number(service.price) <= 0
    ) {
      return error(
        res,
        'This service cannot be purchased online',
        422
      );
    }

    const expectedAmount =
      Math.round(
        Number(service.price) * 100
      );

    if (
      Number(razorpayPayment.amount) !==
      expectedAmount
    ) {
      console.error(
        `[payment] Amount mismatch | expected=${expectedAmount} | received=${razorpayPayment.amount}`
      );

      return error(
        res,
        'Payment amount mismatch',
        400
      );
    }

    /*
     * --------------------------------------------------
     * 5. Only captured payments can create orders
     * --------------------------------------------------
     */
    if (
      razorpayPayment.status !==
      'captured'
    ) {
      return error(
        res,
        `Payment is not captured. Current status: ${razorpayPayment.status}`,
        400
      );
    }

    /*
     * --------------------------------------------------
     * 6. Payment is fully verified.
     *
     * Hand control to createOrder().
     *
     * IMPORTANT:
     * We mark these values as verified internally.
     * createOrder() contains ALL order creation logic.
     * --------------------------------------------------
     */
    req.verifiedPayment = {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_payment_method:
        razorpayPayment.method || null,
      amount: Number(service.price),
    };

    /*
     * Also pass the verified service information so
     * createOrder() doesn't need to trust frontend data.
     */
    req.verifiedService = service;

    /*
     * createOrder() will now:
     *
     * - validate customer
     * - assign staff
     * - generate order number
     * - create order
     * - mark payment as paid
     * - mark order as confirmed
     * - store Razorpay references
     */
    return createOrder(
      req,
      res,
      next
    );

  } catch (err) {
    console.error(
      '[payment] verification error:',
      err
    );

    next(err);
  }
}


module.exports = {
  createPayment,
  verifyPayment,
};