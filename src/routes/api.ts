import { Router } from 'express';
import { enqueueBatch, getResults, getStatus } from '../controllers/verification.controller.js';
import { getSession } from '../controllers/session.controller.js';
const router = Router();
router.post('/verify/batch', enqueueBatch);
router.get('/verify/status/:jobId', getStatus);
router.get('/verify/results/:jobId', getResults);
router.post('/auth/session', getSession);
export default router;
