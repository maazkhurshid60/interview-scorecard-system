const express = require('express');
const scoringController = require('../controllers/scoringController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.patch('/interview/:id/approve', scoringController.approve);
router.patch('/interview/:id/override', scoringController.override);
router.post('/application/:id/recompute', scoringController.recompute);
router.patch('/application/:id/decision', scoringController.decision);

module.exports = router;
