import { AppError } from '../utils/app-error.js';
const maxBalance = 9223372036854775807n;
const dailyLimit = 2000000n;
export function createWalletService(database) {
  async function walletForAccount(db, accountId) {
    const wallet = await db('wallets').where({ account_id: accountId }).first();
    if (!wallet)
      throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
    return wallet;
  }
  async function execute(accountId, input, key, type) {
    return database().transaction(async (trx) => {
      const source = await walletForAccount(trx, accountId);
      const target =
        type === 'transfer'
          ? await walletForAccount(trx, input.recipientAccountId)
          : null;
      if (target && target.id === source.id)
        throw new AppError(
          400,
          'INVALID_RECIPIENT',
          'Cannot transfer to the same wallet',
        );
      const ids = target ? [source.id, target.id] : [source.id];
      const locked = await trx('wallets')
        .whereIn('id', ids)
        .orderBy('id', 'asc')
        .forUpdate();
      const from = locked.find((w) => w.id === source.id);
      const to = target && locked.find((w) => w.id === target.id);
      if (!from || (target && !to))
        throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
      const previous = await trx('transactions')
        .where({ initiator_wallet_id: from.id, idempotency_key: key })
        .first();
      if (previous) {
        if (
          previous.type !== type ||
          previous.amount !== String(input.amount) ||
          previous.recipient_wallet_id !== (to?.id || null)
        )
          throw new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was used with different transaction details',
          );
        const entry = await trx('ledger_entries')
          .where({ transaction_id: previous.id, wallet_id: from.id })
          .first();
        if (!entry) throw new Error('Transaction ledger entry missing');
        return {
          replayed: true,
          transaction: {
            id: previous.id,
            type: previous.type,
            amount: previous.amount,
            balanceBefore: entry.balance_before,
            balanceAfter: entry.balance_after,
            createdAt: previous.created_at,
          },
        };
      }
      const amount = BigInt(input.amount);
      const before = BigInt(from.balance);
      const after = type === 'transfer' ? before - amount : before + amount;
      if (after < 0n)
        throw new AppError(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
      if (
        after > maxBalance ||
        (to && BigInt(to.balance) + amount > maxBalance)
      )
        throw new AppError(
          422,
          'BALANCE_LIMIT',
          'Balance exceeds supported limit',
        );
      const time = (await trx.raw('select clock_timestamp() as current_time'))
        .rows[0].current_time;
      if (type === 'transfer') {
        const total = await trx('transactions')
          .where({ initiator_wallet_id: from.id, type: 'transfer' })
          .whereRaw(
            "created_at >= (date_trunc('day', ?::timestamptz AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta') AND created_at < ((date_trunc('day', ?::timestamptz AT TIME ZONE 'Asia/Jakarta') + interval '1 day') AT TIME ZONE 'Asia/Jakarta')",
            [time, time],
          )
          .sum({ total: 'amount' })
          .first();
        if (BigInt(total.total || 0) + amount > dailyLimit)
          throw new AppError(
            422,
            'DAILY_LIMIT_EXCEEDED',
            'Daily transfer limit exceeded',
          );
      }
      const [transaction] = await trx('transactions')
        .insert({
          initiator_wallet_id: from.id,
          recipient_wallet_id: to?.id || null,
          type,
          amount: String(amount),
          idempotency_key: key,
          created_at: time,
        })
        .returning(['id', 'created_at']);
      await trx('wallets')
        .where({ id: from.id })
        .update({ balance: String(after) });
      await trx('ledger_entries').insert({
        transaction_id: transaction.id,
        wallet_id: from.id,
        balance_before: String(before),
        balance_after: String(after),
        created_at: time,
      });
      if (to) {
        const recipientAfter = BigInt(to.balance) + amount;
        await trx('wallets')
          .where({ id: to.id })
          .update({ balance: String(recipientAfter) });
        await trx('ledger_entries').insert({
          transaction_id: transaction.id,
          wallet_id: to.id,
          balance_before: to.balance,
          balance_after: String(recipientAfter),
          created_at: time,
        });
      }
      return {
        replayed: false,
        transaction: {
          id: transaction.id,
          type,
          amount: String(amount),
          balanceBefore: String(before),
          balanceAfter: String(after),
          createdAt: transaction.created_at,
        },
      };
    });
  }
  return {
    async balance(accountId) {
      const wallet = await walletForAccount(database(), accountId);
      return { balance: wallet.balance, currency: 'IDR' };
    },
    async history(accountId) {
      const wallet = await walletForAccount(database(), accountId);
      return database()('ledger_entries as l')
        .join('transactions as t', 't.id', 'l.transaction_id')
        .where('l.wallet_id', wallet.id)
        .select(
          't.id',
          't.type',
          't.amount',
          'l.balance_before as balanceBefore',
          'l.balance_after as balanceAfter',
          't.created_at as createdAt',
        )
        .orderBy('t.id', 'desc')
        .limit(50);
    },
    topUp(accountId, input, key) {
      return execute(accountId, input, key, 'top_up');
    },
    transfer(accountId, input, key) {
      return execute(accountId, input, key, 'transfer');
    },
  };
}
