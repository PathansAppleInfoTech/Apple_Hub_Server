const express = require('express');
const router = express.Router();
const { login, logout, me, refresh } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

router.post('/login', authLimiter, login);
router.post('/refresh', authLimiter, refresh);
router.post('/logout', logout);
router.get('/me', requireAuth, me);

module.exports = router;
