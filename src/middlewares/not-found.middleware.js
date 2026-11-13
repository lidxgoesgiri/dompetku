import { AppError } from '../utils/app-error.js';
export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', 'Endpoint not found'));
}
