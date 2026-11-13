import { Router } from 'express';
import {
  topUpSchema,
  transferSchema,
  keySchema,
  historyQuerySchema,
  amountSchema,
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
function parseMutation(schema, value) {
  if (!amountSchema.safeParse(value?.amount).success)
    throw new AppError(400, 'INVALID_AMOUNT', 'Invalid amount');
  return parse(schema, value);
}
export function walletRoutes(authenticate, service) {
  const router = Router();
  router.use(authenticate);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get(['/', '/balance'], async (req, res) =>
    success(res, await service.balance(req.accountId)),
  );
  router.get(['/transactions', '/ledger'], async (req, res) => {
    const result = historyQuerySchema.safeParse(req.query);
    if (!result.success)
      throw new AppError(400, 'INVALID_INPUT', 'Invalid history query');
    return success(res, await service.history(req.accountId, result.data));
  });
  router.post(['/top-up', '/topups'], async (req, res) => {
    const result = await service.topUp(
      req.accountId,
      parseMutation(topUpSchema, req.body),
      parse(keySchema, req.get('Idempotency-Key')),
    );
    return success(
      res,
      { ...result.transaction, ...result },
      result.replayed ? 200 : 201,
    );
  });
  router.post(['/transfer', '/transfers'], async (req, res) => {
    const result = await service.transfer(
      req.accountId,
      parseMutation(transferSchema, req.body),
      parse(keySchema, req.get('Idempotency-Key')),
    );
    return success(
      res,
      { ...result.transaction, ...result },
      result.replayed ? 200 : 201,
    );
  });
  return router;
}
