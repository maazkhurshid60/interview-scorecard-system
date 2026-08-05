const express = require('express');
const auditController = require('../controllers/auditController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', auditController.list);

module.exports = router;
