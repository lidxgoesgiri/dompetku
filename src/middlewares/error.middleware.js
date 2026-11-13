import { AppError } from '../utils/app-error.js';
import { failure } from '../utils/api-response.js';
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed')
    return failure(res, 400, 'INVALID_JSON', 'Malformed JSON request body');
  if (err.type === 'entity.too.large')
    return failure(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (err instanceof AppError)
    return failure(res, err.status, err.code, err.message);
  return failure(res, 500, 'INTERNAL_SERVER_ERROR', 'Internal server error');
}
