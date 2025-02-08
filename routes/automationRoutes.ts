import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { createAutomationController,getAllAutomationsController,updateAutomationController,deleteAutomationController, getAutomationByIdController } from '../controllers/automationController';

const router = Router();

/**
 * API Key Management Routes
 * All routes are protected by authentication
 */
router.post('/create', authMiddleware, createAutomationController);
router.put('/update', authMiddleware, updateAutomationController);
router.delete('/delete/:automationId', authMiddleware, deleteAutomationController);

router
  .route('/fetch/all')
  .get(authMiddleware, getAllAutomationsController);

router
  .route('/fetch/:automationId')
  .get(authMiddleware, getAutomationByIdController);

export default router; 