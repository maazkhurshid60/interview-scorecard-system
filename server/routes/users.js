import express from 'express';
import * as userController from '../controllers/userController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);
router.use(requireRole(['owner', 'admin']));

router.get('/', userController.list);
router.post('/', userController.create);
router.patch('/:id', userController.update);
router.delete('/:id', userController.remove);

export default router;
