const express = require('express');
const candidateController = require('../controllers/candidateController');
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth);

router.get('/', candidateController.list);
router.post('/', upload.single('resume'), candidateController.create);
router.get('/:id', candidateController.getOne);
router.patch('/:id', upload.single('resume'), candidateController.update);
router.post('/:id/apply', candidateController.apply);

module.exports = router;
