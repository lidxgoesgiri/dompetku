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
  const auth = authRoutes(authService);
  const wallet = walletRoutes(authMiddleware, walletService);
  router.use(healthRoutes(checkDatabase));
  router.use('/auth', auth);
  router.use('/wallet', wallet);
  router.use('/api', auth);
  router.use('/api', wallet);
  return router;
}
