import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { AppError } from './errorHandler';

type ControllerFunction<T extends Request = Request> = (
  req: T,
  res: Response,
  next: NextFunction
) => Promise<Response | void>;

export const controllerHandler = <T extends Request = Request>(
  fn: ControllerFunction<T>
) => {
  return async (req: T, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res, next);
    } catch (error) {
      next(error instanceof AppError ? error : new AppError('Internal server error', 500));
    }
  };
}; 