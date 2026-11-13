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
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { databaseConfig } from '../../src/config/database.js';
import { createApp } from '../../src/app.js';
const secret = 'test-only-secret-value-32-characters-minimum';
let db, app, accounts, wallets, tokens;
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
  app = createApp({ CORS_ORIGIN: 'http://localhost:3001' }, async () => {}, {
    database: () => db,
    tokenConfig: () => ({ JWT_SECRET: secret, JWT_EXPIRES_IN: '1h' }),
  });
});
afterAll(async () => {
  if (db) await db.destroy();
});
beforeEach(async () => {
  accounts = [];
  wallets = [];
  tokens = [];
  for (let i = 0; i < 2; i++) {
    const [account] = await db('accounts')
      .insert({
        name: 'Wallet test',
        email: `${randomUUID()}@example.invalid`,
        password_hash: '!disabled',
      })
      .returning('id');
    accounts.push(account.id);
    const [wallet] = await db('wallets')
      .insert({ account_id: account.id })
      .returning('id');
    wallets.push(wallet.id);
    tokens.push(
      jwt.sign({}, secret, {
        algorithm: 'HS256',
        subject: String(account.id),
        expiresIn: '1h',
      }),
    );
  }
});
afterEach(async () => {
  if (!db || !accounts?.length) return;
  await db.transaction(async (trx) => {
    const ids = trx('transactions')
      .whereIn('initiator_wallet_id', wallets)
      .select('id');
    await trx('ledger_entries').whereIn('transaction_id', ids).delete();
    await trx('transactions').whereIn('initiator_wallet_id', wallets).delete();
    await trx('wallets').whereIn('id', wallets).delete();
    await trx('accounts').whereIn('id', accounts).delete();
  });
});
const bearer = (index) => `Bearer ${tokens[index]}`;
const topup = (amount, key = randomUUID()) =>
  request(app)
    .post('/wallet/top-up')
    .set('Authorization', bearer(0))
    .set('Idempotency-Key', key)
    .send({ amount });
const transfer = (amount, key = randomUUID()) =>
  request(app)
    .post('/wallet/transfer')
    .set('Authorization', bearer(0))
    .set('Idempotency-Key', key)
    .send({ amount, recipientAccountId: accounts[1] });
describe('wallet transactions', () => {
  it('requires a valid token for wallet endpoints', async () => {
    expect((await request(app).get('/wallet')).status).toBe(401);
    expect(
      (await request(app).get('/wallet').set('Authorization', 'Bearer bad'))
        .status,
    ).toBe(401);
    const expired = jwt.sign({}, secret, {
      subject: accounts[0],
      expiresIn: -1,
    });
    expect(
      (
        await request(app)
          .get('/wallet')
          .set('Authorization', `Bearer ${expired}`)
      ).status,
    ).toBe(401);
  });
  it('top-ups, transfers atomically, and exposes only the owner ledger', async () => {
    expect((await topup(10000)).status).toBe(201);
    const result = await transfer(4000);
    expect(result.status).toBe(201);
    expect(result.body.data.transaction).toMatchObject({
      amount: '4000',
      balanceBefore: '10000',
      balanceAfter: '6000',
    });
    const from = await request(app)
      .get('/wallet')
      .set('Authorization', bearer(0));
    const to = await request(app)
      .get('/wallet')
      .set('Authorization', bearer(1));
    expect(from.body.data.balance).toBe('6000');
    expect(to.body.data.balance).toBe('4000');
    const history = await request(app)
      .get('/wallet/transactions')
      .set('Authorization', bearer(1));
    expect(history.body.data.transactions).toHaveLength(1);
    expect(history.body.data.transactions[0]).toMatchObject({
      amount: '4000',
      balanceBefore: '0',
      balanceAfter: '4000',
    });
    const entries = await db('ledger_entries').where({
      transaction_id: result.body.data.transaction.id,
    });
    expect(entries).toHaveLength(2);
  });
  it('paginates ledger without duplicates and isolates wallet history', async () => {
    for (let i = 0; i < 5; i++) expect((await topup(1000)).status).toBe(201);
    const first = await request(app)
      .get('/wallet/transactions?limit=2')
      .set('Authorization', bearer(0));
    expect(first.status).toBe(200);
    expect(first.body.data.transactions).toHaveLength(2);
    expect(first.body.data.pagination.hasMore).toBe(true);
    const cursor = first.body.data.pagination.nextCursor;
    expect(cursor).toBe(first.body.data.transactions[1].id);
    await topup(1000);
    const second = await request(app)
      .get('/wallet/transactions')
      .query({ limit: '2', before: cursor })
      .set('Authorization', bearer(0));
    const third = await request(app)
      .get('/wallet/transactions')
      .query({ limit: '2', before: second.body.data.pagination.nextCursor })
      .set('Authorization', bearer(0));
    expect(second.body.data.transactions).toHaveLength(2);
    expect(third.body.data.transactions).toHaveLength(1);
    expect(third.body.data.pagination).toEqual({
      hasMore: false,
      nextCursor: null,
    });
    const ids = [first, second, third].flatMap((response) =>
      response.body.data.transactions.map((entry) => entry.id),
    );
    expect(new Set(ids).size).toBe(5);
    const other = await request(app)
      .get('/wallet/transactions')
      .query({ limit: '2', before: cursor })
      .set('Authorization', bearer(1));
    expect(other.body.data).toEqual({
      transactions: [],
      pagination: { hasMore: false, nextCursor: null },
    });
  });
  it('rejects invalid pagination values without exposing errors', async () => {
    for (const query of [
      { limit: '0' },
      { limit: '101' },
      { limit: '1e2' },
      { before: 'invalid' },
      { before: '9223372036854775808' },
      { unknown: 'value' },
      { limit: ['1', '2'] },
    ]) {
      const result = await request(app)
        .get('/wallet/transactions')
        .query(query)
        .set('Authorization', bearer(0));
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('INVALID_INPUT');
    }
  });
  it('returns the first 50 items by default and exposes the next page', async () => {
    const records = Array.from({ length: 51 }, () => ({
      initiator_wallet_id: wallets[0],
      type: 'top_up',
      amount: '1000',
      idempotency_key: randomUUID(),
      request_hash: '0'.repeat(64),
    }));
    await db.transaction(async (trx) => {
      const transactions = await trx('transactions')
        .insert(records)
        .returning('id');
      await trx('ledger_entries').insert(
        transactions.map((transaction, index) => ({
          transaction_id: transaction.id,
          wallet_id: wallets[0],
          type: 'TOPUP',
          amount: 1000,
          balance_before: String(index * 1000),
          balance_after: String((index + 1) * 1000),
        })),
      );
      await trx('wallets')
        .where({ id: wallets[0] })
        .update({ balance: '51000' });
    });
    const first = await request(app)
      .get('/wallet/transactions')
      .set('Authorization', bearer(0));
    expect(first.body.data.transactions).toHaveLength(50);
    expect(first.body.data.pagination.hasMore).toBe(true);
    const next = await request(app)
      .get('/wallet/transactions')
      .query({ before: first.body.data.pagination.nextCursor })
      .set('Authorization', bearer(0));
    expect(next.body.data.transactions).toHaveLength(1);
    expect(next.body.data.pagination).toEqual({
      hasMore: false,
      nextCursor: null,
    });
  });
  it('rejects amounts below minimum and transfers beyond balance without changes', async () => {
    expect((await topup(999)).status).toBe(400);
    const response = await transfer(1000);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(
      (await db('wallets').where({ id: wallets[0] }).first()).balance,
    ).toBe('0');
    expect(
      await db('transactions').where({ initiator_wallet_id: wallets[0] }),
    ).toHaveLength(0);
  });
  it('rejects malformed recipient IDs and missing idempotency keys', async () => {
    const invalid = await request(app)
      .post('/wallet/transfer')
      .set('Authorization', bearer(0))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 1000, recipientAccountId: 'not-an-id' });
    expect(invalid.status).toBe(400);
    const missing = await request(app)
      .post('/wallet/top-up')
      .set('Authorization', bearer(0))
      .send({ amount: 1000 });
    expect(missing.status).toBe(400);
  });
  it('rejects sender impersonation and access to another wallet through query parameters', async () => {
    await topup(5000);
    const response = await request(app)
      .post('/api/transfers')
      .set('Authorization', bearer(0))
      .set('Idempotency-Key', randomUUID())
      .send({
        amount: 1000,
        receiverWalletId: wallets[1],
        senderWalletId: wallets[1],
      });
    expect(response.status).toBe(400);
    const history = await request(app)
      .get('/api/ledger')
      .query({ walletId: wallets[0] })
      .set('Authorization', bearer(1));
    expect(history.status).toBe(400);
    const rows = await db('wallets').whereIn('id', wallets).orderBy('id');
    expect(rows.map((row) => row.balance)).toEqual(['5000', '0']);
  });
  it('rejects self-transfer and missing recipients without leaving successful transactions', async () => {
    await topup(5000);
    for (const [receiverWalletId, status] of [
      [wallets[0], 400],
      ['9223372036854775807', 404],
    ]) {
      const response = await request(app)
        .post('/api/transfers')
        .set('Authorization', bearer(0))
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 1000, receiverWalletId });
      expect(response.status).toBe(status);
    }
    expect(
      await db('transactions').where({
        initiator_wallet_id: wallets[0],
        type: 'transfer',
      }),
    ).toHaveLength(0);
    expect(
      (await db('wallets').where({ id: wallets[0] }).first()).balance,
    ).toBe('5000');
  });
  it('rejects invalid money types and empty keys without reserving transactions', async () => {
    for (const amount of [
      999,
      -1,
      0,
      1000.5,
      '1000',
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      for (const path of ['/api/topups', '/api/transfers']) {
        const body =
          path === '/api/transfers'
            ? { amount, receiverWalletId: wallets[1] }
            : { amount };
        const response = await request(app)
          .post(path)
          .set('Authorization', bearer(0))
          .set('Idempotency-Key', randomUUID())
          .send(body);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('INVALID_AMOUNT');
      }
    }
    const empty = await topup(1000, '');
    expect(empty.status).toBe(400);
    expect(
      await db('transactions').whereIn('initiator_wallet_id', wallets),
    ).toHaveLength(0);
    expect(
      await db('ledger_entries').whereIn('wallet_id', wallets),
    ).toHaveLength(0);
  });
  it('rejects bigint balance overflow without losing precision', async () => {
    const balance = '9223372036854775800';
    await db('wallets').where({ id: wallets[0] }).update({ balance });
    const response = await topup(1000);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('BALANCE_LIMIT');
    expect(
      (await db('wallets').where({ id: wallets[0] }).first()).balance,
    ).toBe(balance);
    expect(
      await db('transactions').where({ initiator_wallet_id: wallets[0] }),
    ).toHaveLength(0);
  });
  it('replays a matching key exactly once and rejects a changed payload', async () => {
    const key = randomUUID();
    const first = await topup(5000, key);
    const replay = await topup(5000, key);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.transaction.id).toBe(
      first.body.data.transaction.id,
    );
    expect((await topup(6000, key)).status).toBe(409);
    expect(
      (await db('wallets').where({ id: wallets[0] }).first()).balance,
    ).toBe('5000');
  });
  it('limits each account to Rp2,000,000 in transfers per Jakarta day', async () => {
    await topup(2500000);
    expect((await transfer(2000000)).status).toBe(201);
    const result = await transfer(1000);
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('DAILY_LIMIT_EXCEEDED');
    expect(
      (await db('wallets').where({ id: wallets[0] }).first()).balance,
    ).toBe('500000');
    expect(
      await db('transactions').where({
        initiator_wallet_id: wallets[0],
        type: 'transfer',
      }),
    ).toHaveLength(1);
  });
  it('does not count transfers from the previous Jakarta calendar day', async () => {
    await topup(3000);
    await db('transactions').insert({
      initiator_wallet_id: wallets[0],
      recipient_wallet_id: wallets[1],
      type: 'transfer',
      amount: '2000000',
      idempotency_key: randomUUID(),
      request_hash: '0'.repeat(64),
      created_at: db.raw(
        "(date_trunc('day', clock_timestamp() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta') - interval '1 second'",
      ),
    });
    const result = await transfer(1000);
    expect(result.status).toBe(201);
    expect(
      (await db('wallets').where({ id: wallets[0] }).first()).balance,
    ).toBe('2000');
  });
  it('resets the daily limit at midnight Jakarta using a controlled database clock', async () => {
    let time = new Date('2026-01-01T16:59:59.000Z');
    const clockApp = createApp(
      { CORS_ORIGIN: 'http://localhost:3001' },
      async () => {},
      {
        database: () => db,
        tokenConfig: () => ({ JWT_SECRET: secret, JWT_EXPIRES_IN: '1h' }),
        clock: async () => time,
      },
    );
    const credit = await request(clockApp)
      .post('/api/topups')
      .set('Authorization', bearer(0))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 4000000 });
    expect(credit.status).toBe(201);
    const send = (amount) =>
      request(clockApp)
        .post('/api/transfers')
        .set('Authorization', bearer(0))
        .set('Idempotency-Key', randomUUID())
        .send({ amount, receiverWalletId: wallets[1] });
    expect((await send(2000000)).status).toBe(201);
    expect((await send(1000)).body.error.code).toBe('DAILY_LIMIT_EXCEEDED');
    time = new Date('2026-01-01T17:00:00.000Z');
    expect((await send(2000000)).status).toBe(201);
    expect(
      (await db('wallets').where({ id: wallets[0] }).first()).balance,
    ).toBe('0');
  });
  it('rolls back balance and transaction when ledger insertion fails', async () => {
    await db('wallets').where({ id: wallets[0] }).update({ balance: '5000' });
    const outer = await db.transaction();
    try {
      await outer.raw(
        "CREATE FUNCTION pg_temp.reject_wallet_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$",
      );
      await outer.raw(
        "CREATE TRIGGER reject_wallet_ledger BEFORE INSERT ON ledger_entries FOR EACH ROW WHEN (NEW.type = 'TRANSFER_IN') EXECUTE FUNCTION pg_temp.reject_wallet_ledger()",
      );
      const failingApp = createApp(
        { CORS_ORIGIN: 'http://localhost:3001' },
        async () => {},
        {
          database: () => outer,
          tokenConfig: () => ({ JWT_SECRET: secret, JWT_EXPIRES_IN: '1h' }),
        },
      );
      const result = await request(failingApp)
        .post('/wallet/transfer')
        .set('Authorization', bearer(0))
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 1000, recipientAccountId: accounts[1] });
      expect(result.status).toBe(500);
      const rows = await outer('wallets').whereIn('id', wallets).orderBy('id');
      expect(rows.map((row) => row.balance)).toEqual(['5000', '0']);
      expect(
        await outer('transactions').where({ initiator_wallet_id: wallets[0] }),
      ).toHaveLength(0);
      expect(
        await outer('ledger_entries').whereIn('wallet_id', wallets),
      ).toHaveLength(0);
    } finally {
      await outer.rollback();
    }
  });
  it('serializes concurrent requests to prevent overspending', async () => {
    await topup(5000);
    const results = await Promise.all([transfer(4000), transfer(4000)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await db('wallets').whereIn('id', wallets).orderBy('id');
    expect(rows.map((row) => row.balance)).toEqual(['1000', '4000']);
  });
  it('reserves idempotency globally for simultaneous different wallets without leaking results', async () => {
    const key = randomUUID();
    const requests = [0, 1].map((index) =>
      request(app)
        .post('/api/topups')
        .set('Authorization', bearer(index))
        .set('Idempotency-Key', key)
        .send({ amount: 1000 }),
    );
    const results = await Promise.all(requests);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const denied = results.find((r) => r.status === 409);
    expect(denied.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(denied.body).not.toHaveProperty('data');
    const rows = await db('wallets').whereIn('id', wallets);
    expect(
      rows.map((row) => BigInt(row.balance)).reduce((a, b) => a + b, 0n),
    ).toBe(1000n);
    expect(
      await db('transactions').where({ idempotency_key: key }),
    ).toHaveLength(1);
  });
  it('enforces the daily cap under concurrent transfers', async () => {
    await topup(3000000);
    const results = await Promise.all([transfer(1500000), transfer(1500000)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409).body.error.code).toBe(
      'DAILY_LIMIT_EXCEEDED',
    );
    expect(
      (await db('wallets').where({ id: wallets[0] }).first()).balance,
    ).toBe('1500000');
  });
  it('supports the PRD API contract using wallet IDs and typed ledger', async () => {
    const balance = await request(app)
      .get('/api/balance')
      .set('Authorization', bearer(0));
    expect(balance.body.data.walletId).toBe(wallets[0]);
    const topup = await request(app)
      .post('/api/topups')
      .set('Authorization', bearer(0))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 2000 });
    expect(topup.status).toBe(201);
    const result = await request(app)
      .post('/api/transfers')
      .set('Authorization', bearer(0))
      .set('Idempotency-Key', randomUUID())
      .send({ amount: 1000, receiverWalletId: wallets[1] });
    expect(result.status).toBe(201);
    expect(result.body.data.type).toBe('TRANSFER');
    const transferRecord = await db('transactions')
      .where({ id: result.body.data.transactionId })
      .first();
    expect(transferRecord.sender_wallet_id).toBe(wallets[0]);
    expect(transferRecord.receiver_wallet_id).toBe(wallets[1]);
    const topupRecord = await db('transactions')
      .where({ id: topup.body.data.transactionId })
      .first();
    expect(topupRecord.sender_wallet_id).toBeNull();
    expect(topupRecord.receiver_wallet_id).toBe(wallets[0]);
    const history = await request(app)
      .get('/api/ledger')
      .set('Authorization', bearer(1));
    expect(history.body.data.transactions[0]).toMatchObject({
      type: 'TRANSFER_IN',
      amount: '1000',
    });
    const longKey = await request(app)
      .post('/api/topups')
      .set('Authorization', bearer(0))
      .set('Idempotency-Key', 'x'.repeat(129))
      .send({ amount: 1000 });
    expect(longKey.status).toBe(400);
  });
  it('serializes concurrent identical idempotency keys', async () => {
    const key = randomUUID();
    const results = await Promise.all([topup(1000, key), topup(1000, key)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(
      (await db('wallets').where({ id: wallets[0] }).first()).balance,
    ).toBe('1000');
  });
  it('processes parallel transfer replays exactly once with two ledger entries', async () => {
    await topup(5000);
    const key = randomUUID();
    const results = await Promise.all([
      transfer(1000, key),
      transfer(1000, key),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 201]);
    expect(results[0].body.data.transaction).toEqual(
      results[1].body.data.transaction,
    );
    const transactions = await db('transactions').where({
      idempotency_key: key,
    });
    expect(transactions).toHaveLength(1);
    expect(
      await db('ledger_entries').where({ transaction_id: transactions[0].id }),
    ).toHaveLength(2);
    const rows = await db('wallets').whereIn('id', wallets).orderBy('id');
    expect(rows.map((row) => row.balance)).toEqual(['4000', '1000']);
  });
  it('replays a transfer after funds are exhausted using the original ledger response', async () => {
    await topup(1000);
    const key = randomUUID();
    const first = await transfer(1000, key);
    const replay = await transfer(1000, key);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data.transaction).toEqual(first.body.data.transaction);
    expect(
      (await db('wallets').where({ id: wallets[0] }).first()).balance,
    ).toBe('0');
    expect(
      await db('transactions').where({ idempotency_key: key }),
    ).toHaveLength(1);
  });
});
