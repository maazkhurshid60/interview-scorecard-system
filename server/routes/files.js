import express from 'express';
import * as fileController from '../controllers/fileController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

router.get('/:kind/:id', fileController.getFile);

export default router;
