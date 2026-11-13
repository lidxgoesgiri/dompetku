import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { spawnSync } from 'node:child_process';
import { createApp } from '../../src/app.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
import { AppError } from '../../src/utils/app-error.js';
const app = createApp({ CORS_ORIGIN: 'http://localhost:3001' }, async () => {});
describe('HTTP foundation', () => {
  it('returns the expected health response', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { status: 'ok', service: 'dompetku', database: 'connected' },
    });
  });
  it('reports a database failure without exposing details', async () => {
    const failedApp = createApp(
      { CORS_ORIGIN: 'http://localhost:3001' },
      async () => {
        throw new Error('sensitive details');
      },
    );
    const response = await request(failedApp).get('/health');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database connection unavailable',
      },
    });
  });
  it('returns a consistent 404', async () => {
    const response = await request(app).get('/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });
  it('rejects malformed JSON', async () => {
    const response = await request(app)
      .post('/missing')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });
  it('adds security headers and disables the framework header', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeTruthy();
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('handles errors without leaking details', async () => {
    const fixture = express();
    fixture.get('/expected', () => {
      throw new AppError(403, 'FORBIDDEN', 'Forbidden');
    });
    fixture.get('/unexpected', () => {
      throw new Error('secret internal details');
    });
    fixture.use(errorHandler);
    const expected = await request(fixture).get('/expected');
    expect(expected.status).toBe(403);
    expect(expected.body).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Forbidden' },
    });
    const unexpected = await request(fixture).get('/unexpected');
    expect(unexpected.status).toBe(500);
    expect(unexpected.body).toEqual({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      },
    });
  });
  it('imports without starting a server or retaining handles', () => {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "await import('./src/app.js'); console.log('imported')",
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    expect(child.stdout.trim()).toBe('imported');
  });
});
