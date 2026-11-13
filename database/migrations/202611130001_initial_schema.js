export async function up(knex) {
  await knex.schema.createTable('accounts', (table) => {
    table.bigIncrements('id').primary();
    table.string('name', 120).notNullable();
    table.string('email', 255).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('wallets', (table) => {
    table.bigIncrements('id').primary();
    table
      .bigInteger('account_id')
      .notNullable()
      .unique()
      .references('id')
      .inTable('accounts')
      .onDelete('RESTRICT');
    table.bigInteger('balance').notNullable().defaultTo(0);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.check('?? >= 0', ['balance'], 'wallet_balance_nonnegative');
  });
  await knex.schema.createTable('transactions', (table) => {
    table.bigIncrements('id').primary();
    table
      .bigInteger('initiator_wallet_id')
      .notNullable()
      .references('id')
      .inTable('wallets')
      .onDelete('RESTRICT');
    table
      .bigInteger('recipient_wallet_id')
      .references('id')
      .inTable('wallets')
      .onDelete('RESTRICT');
    table.string('type', 16).notNullable();
    table.bigInteger('amount').notNullable();
    table.string('idempotency_key', 255).notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.unique(['initiator_wallet_id', 'idempotency_key']);
    table.index(['initiator_wallet_id', 'created_at']);
    table.check('?? >= 1000', ['amount'], 'transaction_minimum_amount');
    table.check(
      "(?? = 'top_up' AND ?? IS NULL) OR (?? = 'transfer' AND ?? IS NOT NULL AND ?? <> ??)",
      [
        'type',
        'recipient_wallet_id',
        'type',
        'recipient_wallet_id',
        'recipient_wallet_id',
        'initiator_wallet_id',
      ],
      'transaction_type_participants',
    );
  });
  await knex.schema.createTable('ledger_entries', (table) => {
    table.bigIncrements('id').primary();
    table
      .bigInteger('transaction_id')
      .notNullable()
      .references('id')
      .inTable('transactions')
      .onDelete('RESTRICT');
    table
      .bigInteger('wallet_id')
      .notNullable()
      .references('id')
      .inTable('wallets')
      .onDelete('RESTRICT');
    table.bigInteger('balance_before').notNullable();
    table.bigInteger('balance_after').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.unique(['transaction_id', 'wallet_id']);
    table.index(['wallet_id', 'created_at']);
    table.check(
      '?? >= 0 AND ?? >= 0',
      ['balance_before', 'balance_after'],
      'ledger_balances_nonnegative',
    );
  });
}
export async function down(knex) {
  await knex.schema.dropTableIfExists('ledger_entries');
  await knex.schema.dropTableIfExists('transactions');
  await knex.schema.dropTableIfExists('wallets');
  await knex.schema.dropTableIfExists('accounts');
}
