const express = require('express');
const router = express.Router();
const { createOrder, getOrder } = require('../controllers/orderController');

// Public — customer checkout + order confirmation lookup
router.post('/', createOrder);
router.get('/:id', getOrder);

module.exports = router;
