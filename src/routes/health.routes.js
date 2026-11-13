import { Router } from 'express';
import { success, failure } from '../utils/api-response.js';

export function healthRoutes(checkDatabase) {
  const router = Router();
  router.get('/health', async (req, res) => {
    try {
      await checkDatabase();
      return success(res, {
        status: 'ok',
        service: 'dompetku',
        database: 'connected',
      });
    } catch {
      return failure(
        res,
        503,
        'DATABASE_UNAVAILABLE',
        'Database connection unavailable',
      );
    }
  });
  return router;
}
