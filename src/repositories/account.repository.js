export function createAccountRepository(database) {
  return {
    async createWithWallet({ name, email, passwordHash }) {
      return database().transaction(async (trx) => {
        const [account] = await trx('accounts')
          .insert({ name, email, password_hash: passwordHash })
          .returning(['id', 'name', 'email', 'created_at']);
        await trx('wallets').insert({ account_id: account.id });
        return account;
      });
    },
    findByEmail(email) {
      return database()('accounts')
        .whereRaw('lower(??) = ?', ['email', email])
        .first();
    },
  };
}
