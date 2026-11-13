import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import knex from 'knex';
import { databaseConfig } from '../../src/config/database.js';
import * as initial from '../../database/migrations/202611130001_initial_schema.js';
import * as prd from '../../database/migrations/202611130003_prd_integrity.js';
let db;
beforeAll(async () => {
  const config = databaseConfig(process.env, 'test');
  if (
    config.connection.database !== process.env.TEST_DB_NAME ||
    config.connection.database === process.env.DB_NAME
  )
    throw new Error('Unsafe database target');
  db = knex(config);
  if (
    (await db.raw('select current_database() as name')).rows[0].name !==
    process.env.TEST_DB_NAME
  )
    throw new Error('Unexpected database');
});
afterAll(async () => {
  if (db) await db.destroy();
});
async function isolated(fn) {
  const trx = await db.transaction();
  try {
    const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
    await trx.schema.createSchema(schema);
    await trx.raw('SET LOCAL search_path TO ??', [schema]);
    await initial.up(trx);
    await fn(trx);
  } finally {
    await trx.rollback();
  }
}
async function account(trx) {
  const [user] = await trx('accounts')
    .insert({
      name: 'Test',
      email: `${randomUUID()}@example.invalid`,
      password_hash: '!disabled',
    })
    .returning('id');
  return (
    await trx('wallets').insert({ account_id: user.id }).returning('id')
  )[0].id;
}
describe('PRD integrity migration', () => {
  it('backfills existing ledger data and reverses the schema without deleting transactions', async () =>
    isolated(async (trx) => {
      const wallet = await account(trx);
      const [transaction] = await trx('transactions')
        .insert({
          initiator_wallet_id: wallet,
          type: 'top_up',
          amount: '1000',
          idempotency_key: randomUUID(),
        })
        .returning('id');
      await trx('ledger_entries').insert({
        transaction_id: transaction.id,
        wallet_id: wallet,
        balance_before: '0',
        balance_after: '1000',
      });
      await prd.up(trx);
      const entry = await trx('ledger_entries')
        .where({ transaction_id: transaction.id })
        .first();
      expect(entry).toMatchObject({ type: 'TOPUP', amount: '1000' });
      expect(
        (await trx('transactions').where({ id: transaction.id }).first())
          .request_hash,
      ).toHaveLength(64);
      await prd.down(trx);
      expect(
        await trx('transactions').where({ id: transaction.id }),
      ).toHaveLength(1);
    }));
  it('refuses duplicate legacy keys without changing the original data', async () =>
    isolated(async (trx) => {
      const first = await account(trx);
      const second = await account(trx);
      const key = randomUUID();
      await trx('transactions').insert([
        {
          initiator_wallet_id: first,
          type: 'top_up',
          amount: 1000,
          idempotency_key: key,
        },
        {
          initiator_wallet_id: second,
          type: 'top_up',
          amount: 1000,
          idempotency_key: key,
        },
      ]);
      await expect(prd.up(trx)).rejects.toThrow(
        'Existing idempotency keys conflict',
      );
      expect(
        await trx('transactions').where({ idempotency_key: key }),
      ).toHaveLength(2);
    }));
});
