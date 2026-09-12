const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { getDashboardStats } = require('../controllers/dashboardController');
const { listAllCategories } = require('../controllers/categoryController');
const { listAllServices } = require('../controllers/serviceController');
const {
  listOrders,
  getOrderDetail,
  updateOrderStatus,
  assignOrder,
} = require('../controllers/orderController');
const { listTeam, createTeamMember, updateTeamMember } = require('../controllers/teamController');

// Everything under /api/admin requires a logged-in admin/staff session.
router.use(requireAuth);

router.get('/dashboard', getDashboardStats);

router.get('/categories', requireRole('admin'), listAllCategories);
router.get('/services', requireRole('admin'), listAllServices);

router.get('/orders', listOrders); // admins see all, staff see only their assigned orders
router.get('/orders/:id', getOrderDetail);
router.put('/orders/:id/status', updateOrderStatus);
router.put('/orders/:id/assign', requireRole('admin'), assignOrder);

router.get('/team', requireRole('admin'), listTeam);
router.post('/team', requireRole('admin'), createTeamMember);
router.put('/team/:id', requireRole('admin'), updateTeamMember);

module.exports = router;
