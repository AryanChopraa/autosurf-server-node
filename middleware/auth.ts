import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/index';
import { controllerHandler } from './controllerHandler';
import { AppError } from './errorHandler';
import { SupabaseClient } from '@supabase/supabase-js';

const supabase = createClient(config.supabaseUrl!, config.supabaseKey!);

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    [key: string]: any;
  };
  supabase?: SupabaseClient;
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

  // Create a new Supabase client with the auth token
  const authenticatedClient = createClient(
    config.supabaseUrl!,
    config.supabaseKey!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );

  const { data: { user }, error } = await authenticatedClient.auth.getUser();

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

  // Attach the authenticated client to the request
  req.supabase = authenticatedClient;
  
  next();
};

export const authMiddleware = controllerHandler<AuthenticatedRequest>(authenticate); 