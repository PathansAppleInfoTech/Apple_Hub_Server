const express = require('express');
const router = express.Router();
const {
  listCategories,
  createCategory,
  updateCategory,
  deactivateCategory,
} = require('../controllers/categoryController');
const { requireAuth, requireRole } = require('../middleware/auth');

// Public
router.get('/', listCategories);

// Admin-only
router.post('/', requireAuth, requireRole('admin'), createCategory);
router.put('/:id', requireAuth, requireRole('admin'), updateCategory);
router.delete('/:id', requireAuth, requireRole('admin'), deactivateCategory);

module.exports = router;
