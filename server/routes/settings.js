import express from 'express';
import * as settingsController from '../controllers/settingsController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);
router.use(requireRole(['owner', 'admin']));

router.get('/', settingsController.list);
router.get('/key-status', settingsController.keyStatus);
router.put('/:key', settingsController.update);
router.post('/test-api', settingsController.testApi);
router.get('/ai-usage', settingsController.aiUsage);

export default router;
