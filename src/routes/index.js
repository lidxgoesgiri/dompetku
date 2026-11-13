import { Router } from 'express';
import { healthRoutes } from './health.routes.js';
export function createRoutes(checkDatabase) {
  const router = Router();
  router.use(healthRoutes(checkDatabase));
  return router;
}
