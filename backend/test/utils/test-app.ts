import { INestApplication, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { seedRbac } from '../../src/access/rbac.seed';
import type { RoleKey } from '../../src/access/permissions';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PasswordService } from '../../src/auth/password.service';
import { AppConfigService } from '../../src/config/app-config.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { assertTestDatabase } from '../test-env';

export const TEST_PASSWORD = 'Correct-Horse-Battery-9';
export const CSRF = { 'X-Requested-With': 'XMLHttpRequest' } as const;

/** Captures every log line so tests can assert secrets are never logged. */
export class CapturingLogger implements LoggerService {
  readonly lines: string[] = [];
  private push(...args: unknown[]) {
    this.lines.push(
      args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' '),
    );
  }
  log = (...a: unknown[]) => this.push(...a);
  error = (...a: unknown[]) => this.push(...a);
  warn = (...a: unknown[]) => this.push(...a);
  debug = (...a: unknown[]) => this.push(...a);
  verbose = (...a: unknown[]) => this.push(...a);
}

export interface TestAppOptions {
  loginRateLimit?: { limit: number; windowSeconds: number };
  logger?: LoggerService;
  /** Extra modules (e.g. test-only fixture controllers). */
  imports?: unknown[];
}

export interface TestContext {
  app: INestApplication<App>;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(
  options: TestAppOptions = {},
): Promise<TestContext> {
  let builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [AppModule, ...((options.imports ?? []) as never[])],
  });
  if (options.loginRateLimit) {
    const override = options.loginRateLimit;
    builder = builder.overrideProvider(AppConfigService).useFactory({
      factory: (cs: ConfigService) => {
        const svc = new AppConfigService(cs as never);
        Object.defineProperty(svc, 'loginRateLimit', { get: () => override });
        return svc;
      },
      inject: [ConfigService],
    });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: options.logger ?? false,
  });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, http: () => request(app.getHttpServer()) };
}

/** Wipe identity data in the TEST database and re-seed roles/permissions. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  assertTestDatabase(process.env.DATABASE_URL); // belt and braces
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_logs", "refresh_tokens", "user_branches", "users", "branches" CASCADE',
  );
  await seedRbac(prisma);
}

export async function createBranch(
  prisma: PrismaService,
  code: string,
  isActive = true,
): Promise<string> {
  const b = await prisma.branch.create({
    data: { code, name: `Branch ${code}`, isActive },
  });
  return b.id;
}

const passwords = new PasswordService();
let cachedHash: Promise<string> | undefined;

export async function createUser(
  prisma: PrismaService,
  opts: {
    email: string;
    roleKey: RoleKey;
    branchIds?: string[];
    isActive?: boolean;
    password?: string;
  },
): Promise<string> {
  const passwordHash =
    opts.password && opts.password !== TEST_PASSWORD
      ? await passwords.hash(opts.password)
      : await (cachedHash ??= passwords.hash(TEST_PASSWORD));
  const role = await prisma.role.findUniqueOrThrow({
    where: { key: opts.roleKey },
  });
  const user = await prisma.user.create({
    data: {
      email: opts.email,
      fullName: opts.email.split('@')[0],
      passwordHash,
      roleId: role.id,
      isActive: opts.isActive ?? true,
      branches: {
        create: (opts.branchIds ?? []).map((branchId) => ({ branchId })),
      },
    },
  });
  return user.id;
}

export interface Session {
  accessToken: string;
  /** Raw `ebms_refresh=...` cookie pair to send back. */
  cookie: string;
  setCookieHeader: string;
}

export function extractRefreshCookie(
  res: request.Response,
): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith('ebms_refresh='));
}

export async function login(
  ctx: TestContext,
  email: string,
  password = TEST_PASSWORD,
): Promise<Session> {
  const res = await ctx
    .http()
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const setCookieHeader = extractRefreshCookie(res)!;
  return {
    accessToken: res.body.data.accessToken,
    cookie: setCookieHeader.split(';')[0],
    setCookieHeader,
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
