import jwt from 'jsonwebtoken';
import { AppError } from '../utils/app-error.js';
export function authenticate(tokenConfig) {
  return (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
    if (!match)
      return next(
        new AppError(401, 'UNAUTHORIZED', 'Valid bearer token required'),
      );
    const config = tokenConfig();
    try {
      const claims = jwt.verify(match[1], config.JWT_SECRET, {
        algorithms: ['HS256'],
      });
      if (
        !Number.isSafeInteger(claims.exp) ||
        typeof claims.sub !== 'string' ||
        !/^[1-9]\d{0,18}$/.test(claims.sub) ||
        BigInt(claims.sub) > 9223372036854775807n
      )
        throw new Error('Invalid subject');
      req.accountId = claims.sub;
      return next();
    } catch {
      return next(
        new AppError(401, 'UNAUTHORIZED', 'Valid bearer token required'),
      );
    }
  };
}
