export async function up(knex) {
  await knex.schema.alterTable('wallets', (table) => {
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });
  await knex.raw(
    "ALTER TABLE transactions ADD COLUMN sender_wallet_id bigint GENERATED ALWAYS AS (CASE WHEN type = 'transfer' THEN initiator_wallet_id ELSE NULL END) STORED",
  );
  await knex.raw(
    "ALTER TABLE transactions ADD COLUMN receiver_wallet_id bigint GENERATED ALWAYS AS (CASE WHEN type = 'top_up' THEN initiator_wallet_id ELSE recipient_wallet_id END) STORED",
  );
  await knex.raw(
    'ALTER TABLE transactions ADD CONSTRAINT transactions_sender_wallet_fk FOREIGN KEY (sender_wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT',
  );
  await knex.raw(
    'ALTER TABLE transactions ADD CONSTRAINT transactions_receiver_wallet_fk FOREIGN KEY (receiver_wallet_id) REFERENCES wallets(id) ON DELETE RESTRICT',
  );
}
export async function down(knex) {
  await knex.raw(
    'ALTER TABLE transactions DROP CONSTRAINT transactions_receiver_wallet_fk, DROP CONSTRAINT transactions_sender_wallet_fk',
  );
  await knex.raw(
    'ALTER TABLE transactions DROP COLUMN receiver_wallet_id, DROP COLUMN sender_wallet_id',
  );
  await knex.schema.alterTable('wallets', (table) => {
    table.dropColumn('updated_at');
  });
}
