import { describe, it, expect } from 'vitest';
import { parseEnv, parseDatabaseEnv } from '../../src/config/env.js';
describe('environment validation', () => {
  it('accepts valid values and converts the port', () => {
    expect(
      parseEnv({
        NODE_ENV: 'test',
        PORT: '4000',
        CORS_ORIGIN: 'http://localhost:3001',
      }),
    ).toEqual({
      NODE_ENV: 'test',
      PORT: 4000,
      CORS_ORIGIN: 'http://localhost:3001',
    });
  });
  it('rejects invalid values without exposing them', () => {
    expect(() => parseEnv({ PORT: 'secret-invalid' })).toThrow(
      'Invalid environment configuration: PORT',
    );
    expect(() => parseEnv({ CORS_ORIGIN: 'invalid' })).toThrow('CORS_ORIGIN');
    expect(() => parseDatabaseEnv({})).toThrow(
      'Invalid database configuration',
    );
  });
});
