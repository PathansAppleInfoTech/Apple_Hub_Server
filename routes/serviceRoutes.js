const express = require('express');
const router = express.Router();
const {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
} = require('../controllers/serviceController');
const { requireAuth, requireRole } = require('../middleware/auth');

// Public
router.get('/', listServices);
router.get('/:idOrSlug', getService);

// Admin-only
router.post('/', requireAuth, requireRole('admin'), createService);
router.put('/:id', requireAuth, requireRole('admin'), updateService);
router.delete('/:id', requireAuth, requireRole('admin'), deleteService);

module.exports = router;
