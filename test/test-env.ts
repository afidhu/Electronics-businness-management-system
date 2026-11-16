import { config } from 'dotenv';
import { resolve } from 'node:path';

/** Test databases must be named like this; anything else is refused. */
export const TEST_DB_NAME_PATTERN = /_test_db$/;

/**
 * Load .env.test (overriding anything inherited from the shell) and make sure
 * tests can only ever reach a dedicated *_test_db database — never the
 * development database (approved Module 1 decision, ADR-014).
 */
export function loadTestEnv(): void {
  config({
    path: resolve(__dirname, '../.env.test'),
    override: true,
    quiet: true,
  });
  process.env.NODE_ENV = 'test';
  assertTestDatabase(process.env.DATABASE_URL);
}

export function assertTestDatabase(url: string | undefined): void {
  if (!url) throw new Error('DATABASE_URL is not set: create .env.test');
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!TEST_DB_NAME_PATTERN.test(dbName)) {
    // Do not print the URL: it contains credentials.
    throw new Error(
      `Refusing to run tests against database "${dbName}": test databases must match ${TEST_DB_NAME_PATTERN}`,
    );
  }
}
