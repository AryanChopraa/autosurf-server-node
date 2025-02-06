import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { createAgentRun, getAllAgentRuns } from '../services/agentServices';
import { AppError } from '../middleware/errorHandler';
import { controllerHandler } from '../middleware/controllerHandler';

export const createAgentRunController = controllerHandler(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { runObjective } = req.body;
    if (!req.user || !req.supabase) {
      throw new AppError('User not authenticated', 401);
    }
    const userId = req.user.id;

    if (!runObjective) {
      throw new AppError('Run objective is required', 400);
    }

    const agentRunId = await createAgentRun(userId, runObjective, req.supabase);
    
    res.status(201).json({
      status: 'success',
      data: { id: agentRunId }
    });
  }
);

export const getAllAgentRunsController = controllerHandler(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.supabase) {
      throw new AppError('User not authenticated', 401);
    }
    const userId = req.user.id;
    
    const agentRuns = await getAllAgentRuns(userId, req.supabase);
    
    res.status(200).json({
      status: 'success',
      results: agentRuns.length,
      data: {
        agentRuns
      }
    });
  }
);