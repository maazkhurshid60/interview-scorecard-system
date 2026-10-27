import express from 'express';
import * as auditController from '../controllers/auditController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);
router.use(requireRole(['owner', 'admin']));

router.get('/', auditController.list);

export default router;
