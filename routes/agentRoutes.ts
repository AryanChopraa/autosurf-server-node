import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createAgentRunController,getAllAgentRunsController } from '../controllers/agentController';
const router = Router();

/**
 * API Key Management Routes
 * All routes are protected by authentication
 */
router
  .route('/create-run')
  .post(authMiddleware, createAgentRunController);

router
  .route('/all-runs')
  .get(authMiddleware, getAllAgentRunsController);

export default router; 