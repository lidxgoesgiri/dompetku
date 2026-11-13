import { describe, it, expect } from 'vitest';
import {
  parseEnv,
  parseDatabaseEnv,
  parseAuthEnv,
} from '../../src/config/env.js';
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

describe('authentication configuration', () => {
  it('requires a sufficiently long secret and validates token lifetime', () => {
    expect(() => parseAuthEnv({ JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
    expect(() =>
      parseAuthEnv({ JWT_SECRET: 'x'.repeat(32), JWT_EXPIRES_IN: 'forever' }),
    ).toThrow('JWT_EXPIRES_IN');
    expect(parseAuthEnv({ JWT_SECRET: 'x'.repeat(32) }).JWT_EXPIRES_IN).toBe(
      '1h',
    );
  });
});
