const express = require('express');
const auditController = require('../controllers/auditController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole(['owner', 'admin']));

router.get('/', auditController.list);

module.exports = router;
