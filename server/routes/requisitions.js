const express = require('express');
const requisitionController = require('../controllers/requisitionController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadPdf } = require('../middleware/upload');
const { publicApplyLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Public routes for candidate self-application (no auth required)
router.get('/:id/public', requisitionController.getPublic);
// Rate limit runs BEFORE multer so a flood never gets as far as buffering uploads.
router.post('/:id/apply', publicApplyLimiter, uploadPdf('resume'), requisitionController.applyPublic);

// Authenticated routes below
router.use(requireAuth);

const canManageReqs = requireRole('owner', 'admin', 'hiring_manager', 'recruiter');

router.post('/generate-field', canManageReqs, requisitionController.generateField);
router.post('/', canManageReqs, requisitionController.create);
router.get('/', requisitionController.list);
router.get('/:id/scorecard', requisitionController.getScorecard);
router.get('/:id', requisitionController.getOne);
router.patch('/:id', canManageReqs, requisitionController.update);
// Deleting a job also deletes its candidates' applications, scores, interviews and files, so only owners and admins may.
router.delete('/:id', requireRole('owner', 'admin'), requisitionController.remove);
router.post('/:id/duplicate', canManageReqs, requisitionController.duplicate);
router.post('/:id/generate-scorecard', canManageReqs, requisitionController.generateScorecard);
router.post('/:id/clone-scorecard', canManageReqs, requisitionController.cloneScorecard);
router.patch('/:id/scorecard', canManageReqs, requisitionController.updateScorecard);
router.get('/:id/ranking', requisitionController.ranking);

module.exports = router;
