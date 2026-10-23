const express = require('express');
const candidateController = require('../controllers/candidateController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { uploadPdf } = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth);

const canManageCandidates = requireRole('owner', 'admin', 'hiring_manager', 'recruiter');

router.get('/', candidateController.list);
router.post('/', canManageCandidates, uploadPdf('resume'), candidateController.create);
router.post('/bulk', canManageCandidates, candidateController.bulkCreate);
router.post('/bulk-attach', canManageCandidates, candidateController.bulkAttach);
router.post('/send-onboarding-form', canManageCandidates, candidateController.sendOnboardingForm);
router.get('/:id', candidateController.getOne);
router.patch('/:id', canManageCandidates, uploadPdf('resume'), candidateController.update);
router.post('/:id/apply', canManageCandidates, candidateController.apply);

// Both delete a candidate's data permanently (applications, interviews, scores, files), so only owners and admins may.
router.delete('/:id/requisitions/:requisitionId', requireRole('owner', 'admin'), candidateController.removeFromRequisition);
router.delete('/:id', requireRole('owner', 'admin'), candidateController.remove);

module.exports = router;
