import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/app-error.js';
const dummyHash =
  '$2b$12$xRLqlzEsda9rvhA4Cxmd7eIzl0oYxVUwVcac4JjRfV.ZJ/fck9KAC';
export function createAuthService(repository, tokenConfig) {
  return {
    async register(input) {
      const passwordHash = await bcrypt.hash(input.password, 12);
      try {
        return await repository.createWithWallet({ ...input, passwordHash });
      } catch (error) {
        if (
          error.code === '23505' &&
          (error.constraint === 'accounts_email_unique' ||
            error.constraint === 'accounts_email_lower_unique')
        )
          throw new AppError(409, 'EMAIL_TAKEN', 'Email is already registered');
        throw error;
      }
    },
    async login(input) {
      const account = await repository.findByEmail(input.email);
      const hash = account?.password_hash?.startsWith('$2')
        ? account.password_hash
        : dummyHash;
      const valid = await bcrypt.compare(input.password, hash);
      if (!account || !valid || hash === dummyHash)
        throw new AppError(
          401,
          'INVALID_CREDENTIALS',
          'Invalid email or password',
        );
      const config = tokenConfig();
      const token = jwt.sign({}, config.JWT_SECRET, {
        algorithm: 'HS256',
        subject: String(account.id),
        expiresIn: config.JWT_EXPIRES_IN,
      });
      return {
        accessToken: token,
        tokenType: 'Bearer',
        expiresAt: new Date(jwt.decode(token).exp * 1000).toISOString(),
      };
    },
  };
}
