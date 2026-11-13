import { z } from 'zod';
const email = z
  .string()
  .trim()
  .max(255)
  .email()
  .transform((value) => value.toLowerCase());
const password = z
  .string()
  .min(8)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72);
export const registrationSchema = z
  .object({ name: z.string().trim().min(1).max(120), email, password })
  .strict();
export const loginSchema = z.object({ email, password }).strict();
