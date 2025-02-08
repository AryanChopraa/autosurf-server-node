import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { createAgentRun, getAgentRunById, getAllAgentRuns } from '../services/agentServices';
import { AppError } from '../middleware/errorHandler';
import { controllerHandler } from '../middleware/controllerHandler';
import { AgentRun, ScriptCommand } from '../types';
import { createAutomation, deleteAutomation, getAllAutomations, getAutomationById, updateAutomation } from '../services/automationServices';

export const createAutomationController = controllerHandler(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const { automationName,agentRunId } = req.body;
    if (!req.user || !req.supabase) {
      throw new AppError('User not authenticated', 401);
    }
    const userId = req.user.id;

    if (!automationName) {
      throw new AppError('Automation name is required', 400);
    }
    const agentRunObject: AgentRun = await getAgentRunById(agentRunId,req.supabase);
    const {run_objective} = agentRunObject;
    const commands: ScriptCommand[] = agentRunObject.commands || [];

    const automationId = await createAutomation(userId, automationName,commands,run_objective, req.supabase);
    
    res.status(201).json({
      status: 'success',
      data: { id: automationId }
    });
  }
);

export const getAllAutomationsController = controllerHandler(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.supabase) {
      throw new AppError('User not authenticated', 401);
    }
    const userId = req.user.id;
    
    const automations = await getAllAutomations(userId, req.supabase);
    
    res.status(200).json({
      status: 'success',
      results: automations.length,
      data: {
        automations
      }
    });
  } 
);

export const getAutomationByIdController = controllerHandler(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.supabase) {
      throw new AppError('User not authenticated', 401);
    }
    const { automationId } = req.params;
    const automation = await getAutomationById(automationId, req.supabase);
    res.status(200).json({
      status: 'success',
      data: automation
    });
  }
);

export const updateAutomationController = controllerHandler(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.supabase) {
      throw new AppError('User not authenticated', 401);
    }
    // console.log(req.body);
    const automation  = req.body;
    await updateAutomation(automation, req.supabase);
    res.status(200).json({
      status: 'success',
      data: automation
    });
  }
);

export const deleteAutomationController = controllerHandler(
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !req.supabase) {
      throw new AppError('User not authenticated', 401);
    }
    const { automationId } = req.params;
    await deleteAutomation(automationId, req.supabase);
    res.status(200).json({
      status: 'success',
      message: 'Automation deleted successfully'
    });
  }
);