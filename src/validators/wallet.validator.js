import { z } from 'zod';
const amount = z.number().int().min(1000).max(Number.MAX_SAFE_INTEGER);
const accountId = z
  .string()
  .refine(
    (value) =>
      /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n,
  );
export const topUpSchema = z.object({ amount }).strict();
export const transferSchema = z
  .object({ amount, recipientAccountId: accountId })
  .strict();
export const keySchema = z.string().trim().min(1).max(255);

export const historyQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
      .transform(Number)
      .optional(),
    before: accountId.optional(),
  })
  .strict();
