import bcrypt from 'bcrypt';
import { transactionFingerprint } from '../utils/transaction-fingerprint.js';
export const demoAccounts = [
  { name: 'Andi', email: 'andi@dompetku.example', balance: '500000' },
  { name: 'Budi', email: 'budi@dompetku.example', balance: '100000' },
  { name: 'Citra', email: 'citra@dompetku.example', balance: '0' },
];
export async function seedDemo(database, password, entries = demoAccounts) {
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    Buffer.byteLength(password, 'utf8') > 72
  )
    throw new Error(
      'Demo password must be 12 characters or more and at most 72 UTF-8 bytes',
    );
  const hash = await bcrypt.hash(password, 12);
  return database.transaction(async (trx) => {
    let created = 0;
    for (const entry of entries) {
      const [account] = await trx('accounts')
        .insert({ name: entry.name, email: entry.email, password_hash: hash })
        .onConflict()
        .ignore()
        .returning('id');
      if (!account) continue;
      const [wallet] = await trx('wallets')
        .insert({ account_id: account.id })
        .returning('id');
      if (BigInt(entry.balance) > 0n) {
        const [transaction] = await trx('transactions')
          .insert({
            initiator_wallet_id: wallet.id,
            type: 'top_up',
            amount: entry.balance,
            idempotency_key: `demo-opening:${account.id}`,
            request_hash: transactionFingerprint('top_up', entry.balance, null),
          })
          .returning('id');
        await trx('wallets')
          .where({ id: wallet.id })
          .update({ balance: entry.balance, updated_at: trx.fn.now() });
        await trx('ledger_entries').insert({
          transaction_id: transaction.id,
          wallet_id: wallet.id,
          type: 'TOPUP',
          amount: entry.balance,
          balance_before: '0',
          balance_after: entry.balance,
        });
      }
      created++;
    }
    return created;
  });
}
