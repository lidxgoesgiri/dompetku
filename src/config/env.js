import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().url().default('http://localhost:3001'),
});
const databaseSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
});
function validate(schema, input, label) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      'Invalid ' +
        label +
        ' configuration: ' +
        result.error.issues.map((issue) => issue.path.join('.')).join(', '),
    );
  return result.data;
}
export const parseEnv = (input) => validate(schema, input, 'environment');
export const parseDatabaseEnv = (input) =>
  validate(databaseSchema, input, 'database');

const authSchema = z.object({
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^[1-9][0-9]{0,3}[smhd]$/)
    .default('1h'),
});
export const parseAuthEnv = (input) =>
  validate(authSchema, input, 'authentication');
