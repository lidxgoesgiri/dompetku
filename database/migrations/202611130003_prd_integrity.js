import { transactionFingerprint } from '../../src/utils/transaction-fingerprint.js';
export async function up(knex) {
  const duplicate = await knex('transactions')
    .select('idempotency_key')
    .groupBy('idempotency_key')
    .havingRaw('count(*) > 1')
    .first();
  const tooLong = await knex('transactions')
    .whereRaw(
      'length(idempotency_key) > 128 OR length(trim(idempotency_key)) = 0',
    )
    .first();
  if (duplicate || tooLong)
    throw new Error(
      'Existing idempotency keys conflict with the PRD; resolve them before migration',
    );
  await knex.schema.alterTable('transactions', (table) => {
    table.string('request_hash', 64);
  });
  await knex.schema.alterTable('ledger_entries', (table) => {
    table.string('type', 16);
    table.bigInteger('amount');
  });
  const transactions = await knex('transactions').select('*');
  for (const transaction of transactions) {
    const entries = await knex('ledger_entries').where({
      transaction_id: transaction.id,
    });
    const expectedWallets =
      transaction.type === 'top_up'
        ? [transaction.initiator_wallet_id]
        : [transaction.initiator_wallet_id, transaction.recipient_wallet_id];
    if (
      entries.length !== expectedWallets.length ||
      expectedWallets.some(
        (id) => !entries.some((entry) => entry.wallet_id === id),
      )
    )
      throw new Error(
        'Existing transaction ledger is incomplete; resolve it before migration',
      );
    for (const entry of entries) {
      const direction =
        transaction.type === 'top_up'
          ? 'TOPUP'
          : entry.wallet_id === transaction.initiator_wallet_id
            ? 'TRANSFER_OUT'
            : 'TRANSFER_IN';
      const delta = BigInt(entry.balance_after) - BigInt(entry.balance_before);
      if (
        delta !==
        (direction === 'TRANSFER_OUT'
          ? -BigInt(transaction.amount)
          : BigInt(transaction.amount))
      )
        throw new Error(
          'Existing transaction ledger has inconsistent balances; resolve it before migration',
        );
      await knex('ledger_entries')
        .where({ id: entry.id })
        .update({ type: direction, amount: transaction.amount });
    }
    await knex('transactions')
      .where({ id: transaction.id })
      .update({
        request_hash: transactionFingerprint(
          transaction.type,
          transaction.amount,
          transaction.recipient_wallet_id,
        ),
      });
  }
  await knex.raw(
    'ALTER TABLE transactions ALTER COLUMN request_hash SET NOT NULL',
  );
  await knex.raw(
    'ALTER TABLE ledger_entries ALTER COLUMN type SET NOT NULL, ALTER COLUMN amount SET NOT NULL',
  );
  await knex.raw(
    'ALTER TABLE transactions DROP CONSTRAINT transactions_initiator_wallet_id_idempotency_key_unique',
  );
  await knex.raw(
    'ALTER TABLE transactions ADD CONSTRAINT transactions_idempotency_key_unique UNIQUE (idempotency_key)',
  );
  await knex.raw(
    'ALTER TABLE transactions ADD CONSTRAINT transactions_idempotency_key_length CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 128)',
  );
  await knex.raw(
    "ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entry_amount_direction CHECK (amount > 0 AND ((type IN ('TOPUP','TRANSFER_IN') AND balance_after::numeric = balance_before::numeric + amount::numeric) OR (type = 'TRANSFER_OUT' AND balance_after::numeric = balance_before::numeric - amount::numeric)))",
  );
}
export async function down(knex) {
  await knex.raw(
    'ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entry_amount_direction',
  );
  await knex.raw(
    'ALTER TABLE transactions DROP CONSTRAINT transactions_idempotency_key_length',
  );
  await knex.raw(
    'ALTER TABLE transactions DROP CONSTRAINT transactions_idempotency_key_unique',
  );
  await knex.raw(
    'ALTER TABLE transactions ADD CONSTRAINT transactions_initiator_wallet_id_idempotency_key_unique UNIQUE (initiator_wallet_id, idempotency_key)',
  );
  await knex.schema.alterTable('ledger_entries', (table) => {
    table.dropColumn('type');
    table.dropColumn('amount');
  });
  await knex.schema.alterTable('transactions', (table) => {
    table.dropColumn('request_hash');
  });
}
