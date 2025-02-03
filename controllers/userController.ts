import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { addApiKey, getApiKey, deleteApiKey, updateApiKey } from '../services/userService';
import { AppError } from '../middleware/errorHandler';
import { controllerHandler } from '../middleware/controllerHandler';

// API Key Management
export const addUserApiKey = controllerHandler<AuthenticatedRequest>(async (req, res) => {
  const { apiKey } = req.body;
  
  if (!apiKey) {
    throw new AppError('API key is required', 400);
  }

  if (!req.user?.id) {
    throw new AppError('User not authenticated', 401);
  }

  const result = await addApiKey(req.user.id, apiKey);
  
  return res.status(201).json({
    status: 'success',
    data: {
      message: 'API key added successfully',
      id: result.id
    }
  });
});

export const getUserApiKey = controllerHandler<AuthenticatedRequest>(async (req, res) => {
  if (!req.user?.id) {
    throw new AppError('User not authenticated', 401);
  }

  const apiKey = await getApiKey(req.user.id);
  
  if (!apiKey) {
    throw new AppError('No API key found', 404);
  }

  return res.status(200).json({
    status: 'success',
    data: {
      apiKey
    }
  });
});

export const deleteUserApiKey = controllerHandler<AuthenticatedRequest>(async (req, res) => {
  if (!req.user?.id) {
    throw new AppError('User not authenticated', 401);
  }

  await deleteApiKey(req.user.id);
  
  return res.status(200).json({
    status: 'success',
    data: {
      message: 'API key deleted successfully'
    }
  });
});

export const updateUserApiKey = controllerHandler<AuthenticatedRequest>(async (req, res) => {
  const { apiKey } = req.body;
  
  if (!apiKey) {
    throw new AppError('New API key is required', 400);
  }

  if (!req.user?.id) {
    throw new AppError('User not authenticated', 401);
  }

  const result = await updateApiKey(req.user.id, apiKey);
  
  return res.status(200).json({
    status: 'success',
    data: {
      message: 'API key updated successfully',
      id: result.id
    }
  });
}); 