import { Router } from 'express';
import {
  topUpSchema,
  transferSchema,
  keySchema,
  historyQuerySchema,
} from '../validators/wallet.validator.js';
import { success } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      400,
      'INVALID_INPUT',
      'Invalid request body or idempotency key',
    );
  return result.data;
}
export function walletRoutes(authenticate, service) {
  const router = Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', async (req, res) =>
    success(res, await service.balance(req.accountId)),
  );
  router.get('/transactions', async (req, res) => {
    const result = historyQuerySchema.safeParse(req.query);
    if (!result.success)
      throw new AppError(400, 'INVALID_INPUT', 'Invalid history query');
    return success(res, await service.history(req.accountId, result.data));
  });
  router.post('/top-up', async (req, res) => {
    const result = await service.topUp(
      req.accountId,
      parse(topUpSchema, req.body),
      parse(keySchema, req.get('Idempotency-Key')),
    );
    return success(res, result, result.replayed ? 200 : 201);
  });
  router.post('/transfer', async (req, res) => {
    const result = await service.transfer(
      req.accountId,
      parse(transferSchema, req.body),
      parse(keySchema, req.get('Idempotency-Key')),
    );
    return success(res, result, result.replayed ? 200 : 201);
  });
  return router;
}
