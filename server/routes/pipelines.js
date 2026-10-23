const express = require('express');
const pipelineController = require('../controllers/pipelineController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

const canManagePipelines = requireRole('owner', 'admin', 'hiring_manager');

router.get('/', pipelineController.list);
router.post('/', canManagePipelines, pipelineController.create);
router.patch('/:id', canManagePipelines, pipelineController.update);
router.put('/:id/default', canManagePipelines, pipelineController.setDefault);
router.delete('/:id', canManagePipelines, pipelineController.remove);

module.exports = router;
