import knex from 'knex';
import { parseDatabaseEnv } from './env.js';
let connection;
export function databaseConfig(input) {
  const env = parseDatabaseEnv(input);
  return {
    client: 'pg',
    connection: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
    },
    pool: { min: 0, max: 10 },
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
