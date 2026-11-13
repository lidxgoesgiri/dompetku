import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { authRoutes } from '../../src/routes/auth.routes.js';
import { errorHandler } from '../../src/middlewares/error.middleware.js';
function fixture() {
  const service = {
    login: vi
      .fn()
      .mockResolvedValue({ accessToken: 'test', tokenType: 'Bearer' }),
    register: vi
      .fn()
      .mockResolvedValue({ id: '1', name: 'Test', email: 'test@example.com' }),
  };
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes(service));
  app.use(errorHandler);
  return { app, service };
}
describe('authentication rate limits', () => {
  it('limits login requests per IP and preserves the response format', async () => {
    const { app, service } = fixture();
    for (let i = 0; i < 10; i++)
      expect(
        (
          await request(app)
            .post('/auth/login')
            .send({ email: 'test@example.com', password: 'password123' })
        ).status,
      ).toBe(200);
    const response = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many requests, please try again later',
      },
    });
    expect(response.headers['retry-after']).toBeTruthy();
    expect(service.login).toHaveBeenCalledTimes(10);
  });
  it('limits registration independently from login', async () => {
    const { app, service } = fixture();
    for (let i = 0; i < 5; i++)
      expect(
        (
          await request(app).post('/auth/register').send({
            name: 'Test',
            email: 'test@example.com',
            password: 'password123',
          })
        ).status,
      ).toBe(201);
    expect(
      (
        await request(app).post('/auth/register').send({
          name: 'Test',
          email: 'test@example.com',
          password: 'password123',
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await request(app)
          .post('/auth/login')
          .send({ email: 'test@example.com', password: 'password123' })
      ).status,
    ).toBe(200);
    expect(service.register).toHaveBeenCalledTimes(5);
  });
});
