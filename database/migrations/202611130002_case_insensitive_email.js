export async function up(knex) {
  await knex.raw(
    'CREATE UNIQUE INDEX accounts_email_lower_unique ON accounts (lower(email))',
  );
}
export async function down(knex) {
  await knex.raw('DROP INDEX accounts_email_lower_unique');
}
