import {
  afterAll,
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
} from 'vitest';
import { randomUUID } from 'node:crypto';
import knex from 'knex';
import request from 'supertest';
import { databaseConfig, closeDatabase } from '../../src/config/database.js';
import { createApp } from '../../src/app.js';

let db, trx, wallets;
const makeTransaction = (overrides = {}) => ({
  initiator_wallet_id: wallets[0],
  recipient_wallet_id: wallets[1],
  type: 'transfer',
  amount: 1000,
  idempotency_key: randomUUID(),
  request_hash: '0'.repeat(64),
  ...overrides,
});
async function rejected(operation, code) {
  await expect(
    trx.transaction(async (savepoint) => operation(savepoint)),
  ).rejects.toMatchObject({ code });
}
beforeAll(async () => {
  const config = databaseConfig(process.env, 'test');
  if (
    config.connection.database !== process.env.TEST_DB_NAME ||
    config.connection.database === process.env.DB_NAME
  )
    throw new Error('Unsafe database target');
  db = knex(config);
  const result = await db.raw('select current_database() as name');
  if (result.rows[0].name !== process.env.TEST_DB_NAME)
    throw new Error('Unexpected connected database');
});
afterAll(async () => {
  await closeDatabase();
  if (db) await db.destroy();
});
beforeEach(async () => {
  trx = await db.transaction();
  wallets = [];
  for (let i = 0; i < 2; i++) {
    const [account] = await trx('accounts')
      .insert({
        name: 'Test account',
        email: `${randomUUID()}@example.invalid`,
        password_hash: '!disabled',
      })
      .returning('id');
    const [wallet] = await trx('wallets')
      .insert({ account_id: account.id, balance: i === 0 ? 5000 : 0 })
      .returning('id');
    wallets.push(wallet.id);
  }
});
afterEach(async () => {
  if (trx) await trx.rollback();
});
describe('PostgreSQL schema', () => {
  it('checks actual database health through HTTP', async () => {
    const response = await request(
      createApp({ CORS_ORIGIN: 'http://localhost:3001' }),
    ).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.data.database).toBe('connected');
  });
  it('returns 503 for an actual failed PostgreSQL connection', async () => {
    const cfg = databaseConfig(process.env, 'test');
    const unavailable = knex({
      ...cfg,
      connection: { ...cfg.connection, port: 1, connectionTimeoutMillis: 1000 },
      acquireConnectionTimeout: 1000,
    });
    try {
      const app = createApp({ CORS_ORIGIN: 'http://localhost:3001' }, () =>
        unavailable.raw('select 1'),
      );
      const response = await request(app).get('/health');
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('DATABASE_UNAVAILABLE');
    } finally {
      await unavailable.destroy();
    }
  });
  it('enforces unique account email and required account fields', async () => {
    const existing = await trx('accounts').first();
    await rejected(
      (s) =>
        s('accounts').insert({
          name: 'Duplicate',
          email: existing.email,
          password_hash: '!disabled',
        }),
      '23505',
    );
    await rejected(
      (s) =>
        s('accounts').insert({
          email: randomUUID() + '@example.invalid',
          password_hash: '!disabled',
        }),
      '23502',
    );
  });
  it('rejects negative wallet and ledger balances', async () => {
    await rejected(
      (s) => s('wallets').where({ id: wallets[0] }).update({ balance: -1 }),
      '23514',
    );
    const [transaction] = await trx('transactions')
      .insert(makeTransaction())
      .returning('id');
    await rejected(
      (s) =>
        s('ledger_entries').insert({
          transaction_id: transaction.id,
          wallet_id: wallets[0],
          type: 'TRANSFER_OUT',
          amount: 1000,
          balance_before: 0,
          balance_after: -1,
        }),
      '23514',
    );
  });
  it('enforces minimum amount, transaction type and participant rules', async () => {
    for (const data of [
      { amount: 999 },
      { type: 'other' },
      { recipient_wallet_id: null },
      { recipient_wallet_id: wallets[0] },
      { type: 'top_up' },
    ]) {
      await rejected(
        (s) => s('transactions').insert(makeTransaction(data)),
        '23514',
      );
    }
    await trx('transactions').insert(
      makeTransaction({ type: 'top_up', recipient_wallet_id: null }),
    );
  });
  it('enforces idempotency globally across wallets', async () => {
    const key = randomUUID();
    await trx('transactions').insert(makeTransaction({ idempotency_key: key }));
    await rejected(
      (s) =>
        s('transactions').insert(makeTransaction({ idempotency_key: key })),
      '23505',
    );
    await rejected(
      (s) =>
        s('transactions').insert(
          makeTransaction({
            initiator_wallet_id: wallets[1],
            recipient_wallet_id: wallets[0],
            idempotency_key: key,
          }),
        ),
      '23505',
    );
  });
  it('enforces wallet ownership, foreign keys and restricted deletes', async () => {
    const wallet = await trx('wallets').where({ id: wallets[0] }).first();
    await rejected(
      (s) => s('wallets').insert({ account_id: wallet.account_id }),
      '23505',
    );
    await rejected(
      (s) => s('wallets').insert({ account_id: '9223372036854775807' }),
      '23503',
    );
    await rejected(
      (s) =>
        s('transactions').insert(
          makeTransaction({ recipient_wallet_id: '9223372036854775807' }),
        ),
      '23503',
    );
    await rejected(
      (s) => s('accounts').where({ id: wallet.account_id }).del(),
      '23503',
    );
  });
  it('stores both sides of a transaction and prevents duplicate ledger entries', async () => {
    const [transaction] = await trx('transactions')
      .insert(makeTransaction())
      .returning('id');
    const debit = {
      transaction_id: transaction.id,
      wallet_id: wallets[0],
      type: 'TRANSFER_OUT',
      amount: 1000,
      balance_before: 5000,
      balance_after: 4000,
    };
    await trx('ledger_entries').insert([
      debit,
      {
        transaction_id: transaction.id,
        wallet_id: wallets[1],
        type: 'TRANSFER_IN',
        amount: 1000,
        balance_before: 0,
        balance_after: 1000,
      },
    ]);
    await trx('wallets').where({ id: wallets[0] }).update({ balance: 4000 });
    await trx('wallets').where({ id: wallets[1] }).update({ balance: 1000 });
    const entries = await trx('ledger_entries').where({
      transaction_id: transaction.id,
    });
    expect(entries).toHaveLength(2);
    expect(
      entries.map((entry) => [entry.balance_before, entry.balance_after]),
    ).toEqual(
      expect.arrayContaining([
        ['5000', '4000'],
        ['0', '1000'],
      ]),
    );
    await rejected((s) => s('ledger_entries').insert(debit), '23505');
    await rejected(
      (s) =>
        s('ledger_entries').insert({
          ...debit,
          transaction_id: '9223372036854775807',
        }),
      '23503',
    );
    await rejected(
      (s) =>
        s('ledger_entries').insert({
          ...debit,
          wallet_id: '9223372036854775807',
        }),
      '23503',
    );
    await rejected(
      (s) => s('transactions').where({ id: transaction.id }).del(),
      '23503',
    );
  });
});
