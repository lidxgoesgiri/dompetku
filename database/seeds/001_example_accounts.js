export async function seed(knex) {
  const expected = process.env.TEST_DB_NAME;
  if (
    process.env.NODE_ENV !== 'test' ||
    !expected ||
    expected === process.env.DB_NAME
  ) {
    throw new Error(
      'Example seed requires a separate test database and NODE_ENV=test',
    );
  }
  const result = await knex.raw('select current_database() as name');
  if (result.rows[0].name !== expected)
    throw new Error('Example seed refused for non-test database');
  const emails = ['student-one@example.invalid', 'student-two@example.invalid'];
  for (const [index, email] of emails.entries()) {
    const [account] = await knex('accounts')
      .insert({
        name: `Example student ${index + 1}`,
        email,
        password_hash: '!login-disabled-example',
      })
      .onConflict('email')
      .ignore()
      .returning('id');
    if (account)
      await knex('wallets').insert({ account_id: account.id, balance: 0 });
  }
}
