import { Router } from 'express';
import { success } from '../utils/api-response.js';
const router = Router();
router.get('/health', (req, res) =>
  success(res, { status: 'ok', service: 'dompetku' }),
);
export default router;
