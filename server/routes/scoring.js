import express from 'express';
import * as scoringController from '../controllers/scoringController.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { uploadPdf } from '../middleware/upload.js';
import { offerPreviewLimiter } from '../middleware/rateLimit.js';

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

export default router;
