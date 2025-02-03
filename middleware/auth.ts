import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { controllerHandler } from './controllerHandler';
import { AppError } from './errorHandler';

const supabase = createClient(config.supabaseUrl!, config.supabaseKey!);

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    [key: string]: any;
  };
}

const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    throw new AppError('No authorization header', 401);
  }

  const token = authHeader.split(' ')[1];
  
  if (!token) {
    throw new AppError('No token provided', 401);
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new AppError('Invalid token', 401);
  }

  if (!user.email) {
    throw new AppError('User email is required', 401);
  }

  req.user = {
    id: user.id,
    email: user.email,
    ...Object.fromEntries(
      Object.entries(user).filter(([key]) => !['id', 'email'].includes(key))
    )
  };
  
  next();
};

export const authMiddleware = controllerHandler<AuthenticatedRequest>(authenticate); 