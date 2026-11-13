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
import bcrypt from 'bcrypt';
import { databaseConfig } from '../../src/config/database.js';
import { seedDemo } from '../../src/services/demo-seed.service.js';
let db, trx;
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
beforeEach(async () => {
  trx = await db.transaction();
});
afterEach(async () => {
  if (trx) await trx.rollback();
});
describe('demo seed', () => {
  it('creates usable examples and opening ledgers once without resetting existing balances', async () => {
    const entries = ['500000', '100000', '0'].map((balance, i) => ({
      name: `Demo ${i}`,
      email: `${randomUUID()}@example.invalid`,
      balance,
    }));
    const password = 'test-only-demo-password';
    expect(await seedDemo(trx, password, entries)).toBe(3);
    const accounts = await trx('accounts')
      .whereIn(
        'email',
        entries.map((entry) => entry.email),
      )
      .orderBy('id');
    expect(accounts).toHaveLength(3);
    expect(await bcrypt.compare(password, accounts[0].password_hash)).toBe(
      true,
    );
    const wallets = await trx('wallets')
      .whereIn(
        'account_id',
        accounts.map((account) => account.id),
      )
      .orderBy('id');
    expect(wallets.map((wallet) => wallet.balance)).toEqual([
      '500000',
      '100000',
      '0',
    ]);
    const ledger = await trx('ledger_entries').whereIn(
      'wallet_id',
      wallets.map((wallet) => wallet.id),
    );
    expect(ledger).toHaveLength(2);
    expect(
      ledger.every(
        (entry) =>
          entry.type === 'TOPUP' &&
          entry.balance_before === '0' &&
          entry.amount === entry.balance_after,
      ),
    ).toBe(true);
    await trx('wallets')
      .where({ id: wallets[0].id })
      .update({ balance: '499000' });
    expect(await seedDemo(trx, password, entries)).toBe(0);
    expect(
      (await trx('wallets').where({ id: wallets[0].id }).first()).balance,
    ).toBe('499000');
    expect(
      await trx('ledger_entries').whereIn(
        'wallet_id',
        wallets.map((wallet) => wallet.id),
      ),
    ).toHaveLength(2);
  }, 20000);
});
