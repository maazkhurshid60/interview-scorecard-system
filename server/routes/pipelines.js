const express = require('express');
const pipelineController = require('../controllers/pipelineController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', pipelineController.list);
router.post('/', pipelineController.create);
router.patch('/:id', pipelineController.update);
router.put('/:id/default', pipelineController.setDefault);
router.delete('/:id', pipelineController.remove);

module.exports = router;
