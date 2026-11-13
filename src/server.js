import 'dotenv/config';
import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { closeDatabase } from './config/database.js';
try {
  const env = parseEnv(process.env);
  const server = createApp(env).listen(env.PORT, () =>
    console.log(
      'DompetKu listening on port ' + env.PORT + ' (' + env.NODE_ENV + ')',
    ),
  );
  server.on('error', () => {
    console.error('Failed to start HTTP server');
    process.exitCode = 1;
  });
  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => {
      console.error('Shutdown timed out');
      process.exit(1);
    }, 10000);
    timeout.unref();
    try {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await closeDatabase();
      clearTimeout(timeout);
    } catch {
      console.error('Failed to shut down cleanly');
      process.exitCode = 1;
    }
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
