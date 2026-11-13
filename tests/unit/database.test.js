import { describe, expect, it } from 'vitest';
import { databaseConfig } from '../../src/config/database.js';
const env = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_NAME: 'dompetku',
  DB_USER: 'test',
  DB_PASSWORD: 'test-only',
};
describe('database configuration', () => {
  it('uses the configured development database', () => {
    expect(databaseConfig(env, 'development').connection.database).toBe(
      'dompetku',
    );
  });
  it('uses an explicitly separate test database', () => {
    expect(
      databaseConfig({ ...env, TEST_DB_NAME: 'dompetku_test' }, 'test')
        .connection.database,
    ).toBe('dompetku_test');
  });
  it('rejects a missing or matching test database', () => {
    expect(() => databaseConfig(env, 'test')).toThrow('TEST_DB_NAME');
    expect(() =>
      databaseConfig({ ...env, TEST_DB_NAME: 'dompetku' }, 'test'),
    ).toThrow('TEST_DB_NAME');
  });
});
