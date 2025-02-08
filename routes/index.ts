import { Router } from 'express';
import userRoutes from './userRoutes';
import agentRoutes from './agentRoutes';
import automationRoutes from './automationRoutes';
const router = Router();

// User routes (includes API key management)
router.use('/users', userRoutes);
router.use('/agent', agentRoutes);
router.use('/automations', automationRoutes);

export default router; 