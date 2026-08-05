const express = require('express');
const interviewController = require('../controllers/interviewController');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

// Google's OAuth redirect hits this URL directly (no bearer token available) — must be public.
router.get('/google/callback', interviewController.googleOAuthCallback);

router.use(requireAuth);

router.get('/', interviewController.list);
router.get('/:id', interviewController.getOne);
router.post('/', interviewController.create);
router.post('/:id/meeting', interviewController.createMeeting);
router.post('/:id/consent', interviewController.recordConsent);
router.post('/:id/fetch-transcript', interviewController.fetchTranscript);
router.post('/:id/upload-transcript', upload.single('transcript'), interviewController.uploadTranscript);
router.post('/:id/upload-artifact', upload.single('artifact'), interviewController.uploadArtifact);
router.post('/:id/score', interviewController.score);

module.exports = router;
