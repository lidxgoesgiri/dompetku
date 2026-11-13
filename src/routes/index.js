import { Router } from 'express';
import { healthRoutes } from './health.routes.js';
import { authRoutes } from './auth.routes.js';
import { walletRoutes } from './wallet.routes.js';
export function createRoutes(
  checkDatabase,
  authService,
  authMiddleware,
  walletService,
) {
  const router = Router();
  router.use(healthRoutes(checkDatabase));
  router.use('/auth', authRoutes(authService));
  router.use('/wallet', walletRoutes(authMiddleware, walletService));
  return router;
}
