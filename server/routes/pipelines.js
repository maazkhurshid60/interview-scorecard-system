import express from 'express';
import * as pipelineController from '../controllers/pipelineController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

const canManagePipelines = requireRole('owner', 'admin', 'hiring_manager');

router.get('/', pipelineController.list);
router.post('/', canManagePipelines, pipelineController.create);
router.patch('/:id', canManagePipelines, pipelineController.update);
router.put('/:id/default', canManagePipelines, pipelineController.setDefault);
router.delete('/:id', canManagePipelines, pipelineController.remove);

export default router;
