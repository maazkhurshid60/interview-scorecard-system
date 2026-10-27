import express from 'express';
import * as departmentController from '../controllers/departmentController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

const canManageDepts = requireRole('owner', 'admin', 'hiring_manager');

router.get('/', departmentController.list);
router.post('/', canManageDepts, departmentController.create);
router.patch('/:id', canManageDepts, departmentController.update);
router.delete('/:id', canManageDepts, departmentController.remove);

export default router;
