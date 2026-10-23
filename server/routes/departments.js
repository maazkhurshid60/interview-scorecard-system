const express = require('express');
const departmentController = require('../controllers/departmentController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

const canManageDepts = requireRole('owner', 'admin', 'hiring_manager');

router.get('/', departmentController.list);
router.post('/', canManageDepts, departmentController.create);
router.patch('/:id', canManageDepts, departmentController.update);
router.delete('/:id', canManageDepts, departmentController.remove);

module.exports = router;
