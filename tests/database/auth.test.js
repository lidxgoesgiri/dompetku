import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import knex from 'knex';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createApp } from '../../src/app.js';
import { databaseConfig } from '../../src/config/database.js';
const secret = 'test-only-secret-value-32-characters-minimum';
let db, trx, app, email;
beforeAll(async () => {
  const config = databaseConfig(process.env, 'test');
  if (
    config.connection.database !== process.env.TEST_DB_NAME ||
    config.connection.database === process.env.DB_NAME
  )
    throw new Error('Unsafe database target');
  db = knex(config);
  const identity = await db.raw('select current_database() as name');
  if (identity.rows[0].name !== process.env.TEST_DB_NAME)
    throw new Error('Unexpected database');
});
afterAll(async () => {
  if (db) await db.destroy();
});
beforeEach(async () => {
  trx = await db.transaction();
  email = `${randomUUID()}@example.invalid`;
  app = createApp({ CORS_ORIGIN: 'http://localhost:3001' }, async () => {}, {
    database: () => trx,
    tokenConfig: () => ({ JWT_SECRET: secret, JWT_EXPIRES_IN: '1h' }),
  });
});
afterEach(async () => {
  if (trx) await trx.rollback();
});
const payload = (email) => ({
  name: 'Test User',
  email,
  password: 'valid-password-123',
});
describe('account authentication', () => {
  it('registers a normalized account and zero-balance wallet without exposing the hash', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send(payload(email.toUpperCase()));
    expect(response.status).toBe(201);
    expect(response.body.data.account.email).toBe(email);
    expect(response.body.data.account).not.toHaveProperty('password_hash');
    const account = await trx('accounts').where({ email }).first();
    expect(account.password_hash).not.toBe('valid-password-123');
    expect(
      await bcrypt.compare('valid-password-123', account.password_hash),
    ).toBe(true);
    const wallets = await trx('wallets').where({ account_id: account.id });
    expect(wallets).toHaveLength(1);
    expect(wallets[0].balance).toBe('0');
  });
  it('rolls back account creation when wallet insertion fails', async () => {
    await trx.raw(
      "CREATE FUNCTION pg_temp.reject_wallet() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced test failure'; END $$",
    );
    await trx.raw(
      'CREATE TRIGGER reject_wallet BEFORE INSERT ON wallets FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_wallet()',
    );
    const response = await request(app)
      .post('/auth/register')
      .send(payload(email));
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(await trx('accounts').where({ email })).toHaveLength(0);
  });
  it('rejects duplicate emails regardless of casing', async () => {
    expect(
      (await request(app).post('/auth/register').send(payload(email))).status,
    ).toBe(201);
    const response = await request(app)
      .post('/auth/register')
      .send(payload(email.toUpperCase()));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_TAKEN');
    expect(await trx('accounts').where({ email })).toHaveLength(1);
  });
  it('issues a signed token for valid credentials', async () => {
    const registration = await request(app)
      .post('/auth/register')
      .send(payload(email));
    const response = await request(app)
      .post('/auth/login')
      .send({ email: email.toUpperCase(), password: 'valid-password-123' });
    expect(response.status).toBe(200);
    expect(response.body.data.tokenType).toBe('Bearer');
    expect(response.headers['cache-control']).toBe('no-store');
    const claims = jwt.verify(response.body.data.accessToken, secret, {
      algorithms: ['HS256'],
    });
    expect(claims.sub).toBe(registration.body.data.account.id);
    expect(claims.exp - claims.iat).toBe(3600);
    expect(claims).not.toHaveProperty('password');
  });
  it('uses the same error for unknown accounts and incorrect passwords', async () => {
    await request(app).post('/auth/register').send(payload(email));
    const wrong = await request(app)
      .post('/auth/login')
      .send({ email, password: 'incorrect-password' });
    const unknown = await request(app)
      .post('/auth/login')
      .send({
        email: `${randomUUID()}@example.invalid`,
        password: 'incorrect-password',
      });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });
  it('rejects invalid inputs, extra fields, and passwords exceeding the bcrypt byte limit', async () => {
    for (const body of [
      payload('invalid'),
      { ...payload(email), name: ' ' },
      { ...payload(email), password: 'short' },
      { ...payload(email), password: 'é'.repeat(37) },
      { ...payload(email), role: 'admin' },
    ]) {
      const response = await request(app).post('/auth/register').send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    }
    expect(await trx('accounts').where({ email })).toHaveLength(0);
  });
});
