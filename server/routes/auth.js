import express from 'express';
import { login, refresh, logout, me, forgotPassword, resetPassword } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', requireAuth, me);

export default router;
