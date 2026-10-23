const express = require('express');
const fileController = require('../controllers/fileController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/:kind/:id', fileController.getFile);

module.exports = router;
