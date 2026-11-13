import { AppError } from '../utils/app-error.js';
import { transactionFingerprint } from '../utils/transaction-fingerprint.js';
const maxBalance = 9223372036854775807n;
const dailyLimit = 2000000n;
export function createWalletService(
  database,
  clock = async (trx) =>
    (await trx.raw('select clock_timestamp() as current_time')).rows[0]
      .current_time,
) {
  async function walletForAccount(db, accountId) {
    const wallet = await db('wallets').where({ account_id: accountId }).first();
    if (!wallet)
      throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
    return wallet;
  }
  async function execute(accountId, input, key, type) {
    return database().transaction(async (trx) => {
      const source = await walletForAccount(trx, accountId);
      let target = null;
      if (type === 'transfer') {
        target = input.receiverWalletId
          ? await trx('wallets').where({ id: input.receiverWalletId }).first()
          : await trx('wallets')
              .where({ account_id: input.recipientAccountId })
              .first();
        if (!target)
          throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
      }
      if (target && target.id === source.id)
        throw new AppError(
          400,
          'INVALID_RECIPIENT',
          'Cannot transfer to the same wallet',
        );
      const locked = await trx('wallets')
        .whereIn('id', target ? [source.id, target.id] : [source.id])
        .orderBy('id', 'asc')
        .forNoKeyUpdate();
      const from = locked.find((w) => w.id === source.id);
      const to = target && locked.find((w) => w.id === target.id);
      if (!from || (target && !to))
        throw new AppError(404, 'WALLET_NOT_FOUND', 'Wallet not found');
      const fingerprint = transactionFingerprint(
        type,
        input.amount,
        to?.id || null,
      );
      const time = await clock(trx);
      const [reservation] = await trx('transactions')
        .insert({
          initiator_wallet_id: from.id,
          recipient_wallet_id: to?.id || null,
          type,
          amount: String(input.amount),
          idempotency_key: key,
          request_hash: fingerprint,
          created_at: time,
        })
        .onConflict('idempotency_key')
        .ignore()
        .returning(['id', 'created_at']);
      if (!reservation) {
        const previous = await trx('transactions')
          .where({ idempotency_key: key })
          .first();
        if (
          !previous ||
          previous.initiator_wallet_id !== from.id ||
          previous.request_hash !== fingerprint
        )
          throw new AppError(
            409,
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key conflicts with a previous request',
          );
        const entry = await trx('ledger_entries')
          .where({ transaction_id: previous.id, wallet_id: from.id })
          .first();
        if (!entry) throw new Error('Transaction ledger entry missing');
        return {
          replayed: true,
          transaction: {
            id: previous.id,
            transactionId: previous.id,
            type: previous.type === 'top_up' ? 'TOPUP' : 'TRANSFER',
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
        throw new AppError(409, 'INSUFFICIENT_BALANCE', 'Insufficient balance');
      if (
        after > maxBalance ||
        (to && BigInt(to.balance) + amount > maxBalance)
      )
        throw new AppError(
          409,
          'BALANCE_LIMIT',
          'Balance exceeds supported limit',
        );
      if (type === 'transfer') {
        const total = await trx('transactions')
          .where({ initiator_wallet_id: from.id, type: 'transfer' })
          .whereNot({ id: reservation.id })
          .whereRaw(
            "created_at >= (date_trunc('day', ?::timestamptz AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta') AND created_at < ((date_trunc('day', ?::timestamptz AT TIME ZONE 'Asia/Jakarta') + interval '1 day') AT TIME ZONE 'Asia/Jakarta')",
            [time, time],
          )
          .sum({ total: 'amount' })
          .first();
        if (BigInt(total.total || 0) + amount > dailyLimit)
          throw new AppError(
            409,
            'DAILY_LIMIT_EXCEEDED',
            'Daily transfer limit exceeded',
          );
      }
      await trx('wallets')
        .where({ id: from.id })
        .update({ balance: String(after), updated_at: time });
      await trx('ledger_entries').insert({
        transaction_id: reservation.id,
        wallet_id: from.id,
        type: type === 'top_up' ? 'TOPUP' : 'TRANSFER_OUT',
        amount: String(amount),
        balance_before: String(before),
        balance_after: String(after),
        created_at: time,
      });
      if (to) {
        const recipientAfter = BigInt(to.balance) + amount;
        await trx('wallets')
          .where({ id: to.id })
          .update({ balance: String(recipientAfter), updated_at: time });
        await trx('ledger_entries').insert({
          transaction_id: reservation.id,
          wallet_id: to.id,
          type: 'TRANSFER_IN',
          amount: String(amount),
          balance_before: to.balance,
          balance_after: String(recipientAfter),
          created_at: time,
        });
      }
      return {
        replayed: false,
        transaction: {
          id: reservation.id,
          transactionId: reservation.id,
          type: type === 'top_up' ? 'TOPUP' : 'TRANSFER',
          amount: String(amount),
          balanceBefore: String(before),
          balanceAfter: String(after),
          createdAt: reservation.created_at,
        },
      };
    });
  }
  return {
    async balance(accountId) {
      const wallet = await walletForAccount(database(), accountId);
      return { walletId: wallet.id, balance: wallet.balance, currency: 'IDR' };
    },
    async history(accountId, { limit = 50, before } = {}) {
      const wallet = await walletForAccount(database(), accountId);
      const query = database()('ledger_entries as l')
        .join('transactions as t', 't.id', 'l.transaction_id')
        .where('l.wallet_id', wallet.id)
        .select(
          't.id',
          'l.type',
          'l.amount',
          'l.balance_before as balanceBefore',
          'l.balance_after as balanceAfter',
          't.created_at as createdAt',
        )
        .orderBy('t.id', 'desc')
        .limit(limit + 1);
      if (before) query.where('t.id', '<', before);
      const rows = await query;
      const hasMore = rows.length > limit;
      const transactions = rows.slice(0, limit);
      return {
        transactions,
        pagination: {
          hasMore,
          nextCursor: hasMore ? transactions[transactions.length - 1].id : null,
        },
      };
    },
    topUp(accountId, input, key) {
      return execute(accountId, input, key, 'top_up');
    },
    transfer(accountId, input, key) {
      return execute(accountId, input, key, 'transfer');
    },
  };
}
