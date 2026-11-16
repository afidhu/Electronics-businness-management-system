import { assertTestDatabase } from './test-env';

describe('assertTestDatabase (dev-database protection)', () => {
  it('allows databases named *_test_db', () => {
    expect(() =>
      assertTestDatabase(
        'postgresql://u:p@localhost:5432/electrocore_test_db?schema=public',
      ),
    ).not.toThrow();
  });

  it.each([
    'postgresql://u:p@localhost:5432/electrocore_db?schema=public',
    'postgresql://u:p@localhost:5432/electrocore_db_shadow',
    'postgresql://u:p@localhost:5432/electrocore_test_db_backup',
    'postgresql://u:p@localhost:5432/postgres',
  ])('refuses %s', (url) => {
    expect(() => assertTestDatabase(url)).toThrow(/Refusing to run tests/);
  });

  it('refuses a missing URL and never echoes credentials', () => {
    expect(() => assertTestDatabase(undefined)).toThrow(
      /DATABASE_URL is not set/,
    );
    try {
      assertTestDatabase(
        'postgresql://u:topsecret@localhost:5432/electrocore_db',
      );
    } catch (e) {
      expect((e as Error).message).not.toContain('topsecret');
    }
  });

  it('is active in this run: tests are pointed at the test database', () => {
    expect(new URL(process.env.DATABASE_URL!).pathname).toBe(
      '/electrocore_test_db',
    );
    expect(process.env.NODE_ENV).toBe('test');
  });
});
