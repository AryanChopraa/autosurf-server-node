import { Router } from 'express';
import userRoutes from './userRoutes';

const router = Router();

// User routes (includes API key management)
router.use('/users', userRoutes);

export default router; 