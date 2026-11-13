import knex from 'knex';
import { parseDatabaseEnv } from './env.js';
let connection;
export function databaseConfig(
  input,
  environment = input.NODE_ENV || 'development',
) {
  const env = parseDatabaseEnv(input);
  let database = env.DB_NAME;
  if (environment === 'test') {
    if (!input.TEST_DB_NAME || input.TEST_DB_NAME === env.DB_NAME) {
      throw new Error('TEST_DB_NAME must be set and different from DB_NAME');
    }
    database = input.TEST_DB_NAME;
  }
  return {
    client: 'pg',
    connection: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      connectionTimeoutMillis: 3000,
    },
    pool: { min: 0, max: 10 },
    acquireConnectionTimeout: 3000,
    migrations: { directory: './database/migrations' },
    seeds: { directory: './database/seeds' },
  };
}
export function getDatabase() {
  if (!connection) connection = knex(databaseConfig(process.env));
  return connection;
}
export async function closeDatabase() {
  if (connection) {
    const current = connection;
    connection = undefined;
    await current.destroy();
  }
}
