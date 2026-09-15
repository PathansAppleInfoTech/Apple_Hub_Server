const express = require('express');
const router = express.Router();
const { createPayment, verifyPayment } = require('../controllers/paymentController');

// Public — checkout flow calls this after creating an order
router.post('/create', createPayment);

router.post('/verify', verifyPayment);

module.exports = router;
