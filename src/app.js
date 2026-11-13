import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createRoutes } from './routes/index.js';
import { notFound } from './middlewares/not-found.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { parseEnv } from './config/env.js';
import { getDatabase } from './config/database.js';
export function createApp(
  env = parseEnv(process.env),
  checkDatabase = () => getDatabase().raw('select 1'),
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: '100kb' }));
  app.use(createRoutes(checkDatabase));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
export default createApp;
