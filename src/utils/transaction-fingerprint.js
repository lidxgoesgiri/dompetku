import { createHash } from 'node:crypto';
export function transactionFingerprint(type, amount, recipientWalletId) {
  return createHash('sha256')
    .update(JSON.stringify([type, String(amount), recipientWalletId || null]))
    .digest('hex');
}
