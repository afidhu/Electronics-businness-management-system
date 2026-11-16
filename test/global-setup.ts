import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadTestEnv } from './test-env';

/**
 * E2E `globalSetup`: apply committed migrations to the TEST database only.
 * Uses `migrate deploy` (never `migrate reset`/`dev`), so it cannot drop data
 * and cannot touch the development database (guarded by loadTestEnv).
 */
export default function globalSetup(): void {
  loadTestEnv();
  const prismaCli = resolve(__dirname, '../node_modules/prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: resolve(__dirname, '..'),
    env: process.env,
    stdio: 'pipe',
  });
}
