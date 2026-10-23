const express = require('express');
const scoringController = require('../controllers/scoringController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadPdf } = require('../middleware/upload');
const { offerPreviewLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.use(requireAuth);

const canDecide = requireRole('owner', 'admin', 'hiring_manager', 'recruiter');
const canOverrideScores = requireRole('owner', 'admin', 'hiring_manager');

router.patch('/interview/:id/approve', canDecide, scoringController.approve);
router.patch('/interview/:id/override', canOverrideScores, scoringController.override);
router.patch('/interview/:id/pass-fail', scoringController.passFail);
router.patch('/application/:id/override-initial-screening', canDecide, scoringController.overrideInitialScreening);
router.post('/application/:id/recompute', canDecide, scoringController.recompute);
router.patch('/application/:id/decision', canDecide, scoringController.decision);
router.get('/offer-letter-templates', scoringController.getOfferLetterTemplates);
router.post('/application/:id/offer-letter-preview', offerPreviewLimiter, canDecide, scoringController.previewOfferLetter);
router.post('/application/:id/send-offer-letter', uploadPdf('offerLetter'), canDecide, scoringController.sendOfferLetter);

module.exports = router;
