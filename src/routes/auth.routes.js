import { Router } from 'express';
import {
  registrationSchema,
  loginSchema,
} from '../validators/auth.validator.js';
import { success } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { authRateLimit } from '../middlewares/auth-rate-limit.middleware.js';
function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(400, 'INVALID_INPUT', 'Invalid request body');
  return result.data;
}
export function authRoutes(service) {
  const router = Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.post('/register', authRateLimit(5), async (req, res) => {
    const account = await service.register(
      validate(registrationSchema, req.body),
    );
    return success(
      res,
      {
        account: {
          id: String(account.id),
          name: account.name,
          email: account.email,
          createdAt: account.created_at,
        },
      },
      201,
    );
  });
  router.post('/login', authRateLimit(10), async (req, res) =>
    success(res, await service.login(validate(loginSchema, req.body))),
  );
  return router;
}
