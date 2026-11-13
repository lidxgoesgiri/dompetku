import { rateLimit } from 'express-rate-limit';
import { failure } from '../utils/api-response.js';
export function authRateLimit(limit) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) =>
      failure(
        res,
        429,
        'TOO_MANY_REQUESTS',
        'Too many requests, please try again later',
      ),
  });
}
