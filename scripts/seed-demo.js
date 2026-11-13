import 'dotenv/config';
import { getDatabase, closeDatabase } from '../src/config/database.js';
import { seedDemo } from '../src/services/demo-seed.service.js';
try {
  if (process.env.DEMO_SEED !== 'enabled')
    throw new Error('Set DEMO_SEED=enabled to explicitly run the demo seed');
  const created = await seedDemo(getDatabase(), process.env.DEMO_PASSWORD);
  console.log(`Demo seed completed: ${created} new accounts`);
} catch {
  console.error(
    'Demo seed failed; check configuration and database permissions',
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
