import { Router } from 'express';
import { healthRoutes } from './health.routes.js';
import { authRoutes } from './auth.routes.js';
export function createRoutes(checkDatabase, authService) {
  const router = Router();
  router.use(healthRoutes(checkDatabase));
  router.use('/auth', authRoutes(authService));
  return router;
}
