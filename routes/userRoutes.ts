import { Router } from 'express';
import { 
  addUserApiKey,
  getUserApiKey,
  deleteUserApiKey,
  updateUserApiKey
} from '../controllers/userController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

/**
 * API Key Management Routes
 * All routes are protected by authentication
 */
router
  .route('/api-keys')
  .post(authMiddleware, addUserApiKey)
  .get(authMiddleware, getUserApiKey)
  .put(authMiddleware, updateUserApiKey)
  .delete(authMiddleware, deleteUserApiKey);

export default router; 