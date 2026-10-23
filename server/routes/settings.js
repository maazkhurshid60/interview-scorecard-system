const express = require('express');
const settingsController = require('../controllers/settingsController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.use(requireRole(['owner', 'admin']));

router.get('/', settingsController.list);
router.get('/key-status', settingsController.keyStatus);
router.put('/:key', settingsController.update);
router.post('/test-api', settingsController.testApi);
router.get('/ai-usage', settingsController.aiUsage);

module.exports = router;
