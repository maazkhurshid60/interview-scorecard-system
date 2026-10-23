const express = require('express');
const interviewController = require('../controllers/interviewController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { upload, uploadPdf } = require('../middleware/upload');
const { publicAvailabilityLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Google's OAuth redirect hits this URL directly (no bearer token available) — must be public.
router.get('/google/callback', interviewController.googleOAuthCallback);

// Public candidate availability endpoints (no auth token required)
router.get('/:id/availability/public', interviewController.getPublicAvailability);
router.post('/:id/availability/public', publicAvailabilityLimiter, interviewController.submitPublicAvailability);

router.use(requireAuth);

const canSchedule = requireRole('owner', 'admin', 'hiring_manager', 'recruiter');

router.get('/', interviewController.list);
router.get('/:id', interviewController.getOne);
router.post('/', canSchedule, interviewController.create);
router.post('/:id/meeting', canSchedule, interviewController.createMeeting);
router.delete('/:id/meeting', canSchedule, interviewController.cancelMeeting);
router.post('/:id/send-meeting-email', canSchedule, interviewController.sendMeetingEmail);
router.post('/:id/request-availability', canSchedule, interviewController.requestAvailability);
router.post('/:id/consent', interviewController.recordConsent);
router.post('/:id/fetch-transcript', interviewController.fetchTranscript);
router.post('/:id/upload-transcript', upload.single('transcript'), interviewController.uploadTranscript);
router.post('/:id/upload-artifact', uploadPdf('artifact'), interviewController.uploadArtifact);
router.post('/:id/send-offer', canSchedule, uploadPdf('offerLetter'), interviewController.sendOffer);
router.post('/:id/score', interviewController.score);

module.exports = router;
