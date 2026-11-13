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
import { databaseConfig } from '../../src/config/database.js';
import { createApp } from '../../src/app.js';

const secret = 'integration-test-secret-at-least-32-characters';
let db, trx, app;
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
  app = createApp(
    { CORS_ORIGIN: 'http://localhost:3001' },
    () => trx.raw('select 1'),
    {
      database: () => trx,
      tokenConfig: () => ({ JWT_SECRET: secret, JWT_EXPIRES_IN: '1h' }),
    },
  );
});
afterEach(async () => {
  if (trx) await trx.rollback();
});
async function createUser(name) {
  const email = `${randomUUID()}@example.invalid`;
  const password = 'integration-password-123';
  const registration = await request(app)
    .post('/api/register')
    .send({ name, email, password });
  expect(registration.status).toBe(201);
  const login = await request(app).post('/api/login').send({ email, password });
  expect(login.status).toBe(200);
  expect(Date.parse(login.body.data.expiresAt)).toBeGreaterThan(Date.now());
  const balance = await request(app)
    .get('/api/balance')
    .set('Authorization', `Bearer ${login.body.data.accessToken}`);
  expect(balance.status).toBe(200);
  return {
    id: registration.body.data.account.id,
    token: login.body.data.accessToken,
    walletId: balance.body.data.walletId,
  };
}
const withToken = (token) => `Bearer ${token}`;
describe('end-to-end business flow', () => {
  it('registers, authenticates, tops up and transfers once with consistent balances and ledger', async () => {
    const sender = await createUser('Sender');
    const recipient = await createUser('Recipient');
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.data.database).toBe('connected');
    const initial = await request(app)
      .get('/api/balance')
      .set('Authorization', withToken(sender.token));
    expect(initial.body.data.balance).toBe('0');
    const topup = await request(app)
      .post('/api/topups')
      .set('Authorization', withToken(sender.token))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 2100000 });
    expect(topup.status).toBe(201);
    const key = randomUUID();
    const transfer = () =>
      request(app)
        .post('/api/transfers')
        .set('Authorization', withToken(sender.token))
        .set('Idempotency-Key', key)
        .send({ amount: 2000000, receiverWalletId: recipient.walletId });
    const first = await transfer();
    expect(first.status).toBe(201);
    expect(first.body.data.transaction).toMatchObject({
      balanceBefore: '2100000',
      balanceAfter: '100000',
      amount: '2000000',
    });
    const replay = await transfer();
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.transaction.id).toBe(
      first.body.data.transaction.id,
    );
    const overLimit = await request(app)
      .post('/api/transfers')
      .set('Authorization', withToken(sender.token))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 1000, receiverWalletId: recipient.walletId });
    expect(overLimit.status).toBe(409);
    expect(overLimit.body.error.code).toBe('DAILY_LIMIT_EXCEEDED');
    const insufficient = await request(app)
      .post('/api/transfers')
      .set('Authorization', withToken(sender.token))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 101000, receiverWalletId: recipient.walletId });
    expect(insufficient.status).toBe(409);
    expect(insufficient.body.error.code).toBe('INSUFFICIENT_BALANCE');
    const belowMinimum = await request(app)
      .post('/api/topups')
      .set('Authorization', withToken(sender.token))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 999 });
    expect(belowMinimum.status).toBe(400);
    const senderBalance = await request(app)
      .get('/api/balance')
      .set('Authorization', withToken(sender.token));
    const recipientBalance = await request(app)
      .get('/api/balance')
      .set('Authorization', withToken(recipient.token));
    expect(senderBalance.body.data.balance).toBe('100000');
    expect(recipientBalance.body.data.balance).toBe('2000000');
    const senderHistory = await request(app)
      .get('/api/ledger')
      .set('Authorization', withToken(sender.token));
    const recipientHistory = await request(app)
      .get('/api/ledger')
      .set('Authorization', withToken(recipient.token));
    expect(senderHistory.body.data.transactions).toHaveLength(2);
    expect(recipientHistory.body.data.transactions).toHaveLength(1);
    expect(recipientHistory.body.data.transactions[0]).toMatchObject({
      id: first.body.data.transaction.id,
      balanceBefore: '0',
      balanceAfter: '2000000',
    });
    const entries = await trx('ledger_entries').where({
      transaction_id: first.body.data.transaction.id,
    });
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.wallet_id)).size).toBe(2);
  }, 20000);
});
