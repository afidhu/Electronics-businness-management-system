import { hash, verify } from '@node-rs/argon2';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * `Algorithm` is a const enum in @node-rs/argon2, which isolatedModules cannot
 * import; 2 === Algorithm.Argon2id (asserted in auth-units.spec.ts via the `$argon2id$` hash prefix).
 */
export const ARGON2ID = 2;

/** OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane). */
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Password policy (ADR-018): length-based, per NIST SP 800-63B. */
export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound protects the hasher from oversized input. */
export const PASSWORD_MAX_LENGTH = 128;

@Injectable()
export class PasswordService {
  /**
   * A real hash of a random value, verified when the email is unknown so the
   * response time does not reveal whether an account exists.
   */
  private dummyHash?: Promise<string>;

  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plain);
    } catch {
      return false; // malformed hash: treat as mismatch, never throw details
    }
  }

  /** Burn the same CPU/memory as a real verification. Always false. */
  async verifyAgainstDummy(plain: string): Promise<false> {
    this.dummyHash ??= this.hash(`dummy-${Math.random()}-${Date.now()}`);
    await this.verify(await this.dummyHash, plain);
    return false;
  }

  /** Throws 400 WEAK_PASSWORD when the policy is not met. */
  assertAcceptable(plain: string, context: { email?: string } = {}): void {
    const problems: string[] = [];
    if (plain.length < PASSWORD_MIN_LENGTH)
      problems.push(`must be at least ${PASSWORD_MIN_LENGTH} characters`);
    if (plain.length > PASSWORD_MAX_LENGTH)
      problems.push(`must be at most ${PASSWORD_MAX_LENGTH} characters`);
    if (plain.trim().length === 0) problems.push('must not be blank');
    if (/^(.)\1+$/.test(plain)) problems.push('must not repeat one character');
    const local = context.email?.split('@')[0]?.toLowerCase();
    if (local && local.length >= 4 && plain.toLowerCase().includes(local))
      problems.push('must not contain the email name');

    if (problems.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.WEAK_PASSWORD,
        'Password does not meet the policy',
        [{ field: 'password', messages: problems.map((p) => `password ${p}`) }],
      );
    }
  }
}
