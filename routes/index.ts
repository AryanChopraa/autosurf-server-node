import { Router } from 'express';
import userRoutes from './userRoutes';
import agentRoutes from './agentRoutes';
const router = Router();

// User routes (includes API key management)
router.use('/users', userRoutes);
router.use('/agent', agentRoutes);

export default router; 