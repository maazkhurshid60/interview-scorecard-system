const express = require('express');
const requisitionController = require('../controllers/requisitionController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.post('/', requisitionController.create);
router.get('/', requisitionController.list);
router.get('/:id', requisitionController.getOne);
router.patch('/:id', requisitionController.update);
router.delete('/:id', requisitionController.remove);
router.post('/:id/generate-scorecard', requisitionController.generateScorecard);
router.post('/:id/clone-scorecard', requisitionController.cloneScorecard);
router.patch('/:id/scorecard', requisitionController.updateScorecard);
router.get('/:id/ranking', requisitionController.ranking);

module.exports = router;
