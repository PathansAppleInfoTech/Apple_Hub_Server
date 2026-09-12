const express = require('express');
const router = express.Router();
const { createPayment, handleWebhook } = require('../controllers/paymentController');

// Public — checkout flow calls this after creating an order
router.post('/create', createPayment);

// Called by the payment gateway server-to-server, not the browser
router.post('/webhook', handleWebhook);

module.exports = router;
