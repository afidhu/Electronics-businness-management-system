import {
  Body,
  Controller,
  Get,
  INestApplication,
  Module,
  Post,
  Query,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { IsNotEmpty, IsString } from 'class-validator';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { Public } from '../src/auth/decorators';
import { configureApp } from '../src/app.setup';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../src/common/pagination/pagination';
import { IsMoneyAmount } from '../src/common/validation/is-money-amount.decorator';

// ---- Test-only fixture endpoints (exercise the global pipeline over HTTP) ----
class EchoDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsMoneyAmount()
  amount: string;
}

// Public: these exercise the Module 1 HTTP pipeline, not authentication.
@Public()
@Controller('__fixtures')
class FixtureController {
  @Get('items')
  list(@Query() query: PaginationQueryDto) {
    return new PaginatedResult([{ id: 'a' }], 41, query);
  }

  @Post('echo')
  echo(@Body() dto: EchoDto) {
    return dto;
  }

  @Get('crash')
  crash(): never {
    throw new Error('internal detail: password=hunter2 at /srv/app/db.ts:42');
  }
}

@Module({ controllers: [FixtureController] })
class FixtureModule {}
// ------------------------------------------------------------------------------

const UUID = /^[0-9a-f-]{36}$/;

describe('Module 1 foundation (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule, FixtureModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 with the success envelope and the database up', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);
      expect(res.body).toMatchObject({
        data: { status: 'ok', checks: { database: 'up' } },
        meta: { requestId: expect.stringMatching(UUID) },
      });
      expect(res.headers['x-request-id']).toBe(res.body.meta.requestId);
      expect(Date.parse(res.body.data.timestamp)).not.toBeNaN();
      expect(res.body.data.timestamp).toMatch(/Z$/); // UTC
    });

    it('echoes a safe incoming X-Request-Id', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('X-Request-Id', 'proxy-req-000123')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('proxy-req-000123');
      expect(res.body.meta.requestId).toBe('proxy-req-000123');
    });

    it('sends security headers (helmet)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('routing and errors', () => {
    it('removed the starter demo routes and serves nothing outside /api/v1', async () => {
      await request(app.getHttpServer()).get('/').expect(404);
      await request(app.getHttpServer()).get('/afidhu').expect(404);
      await request(app.getHttpServer()).get('/health').expect(404);
    });

    it('returns the documented error shape for unknown routes', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .expect(404);
      expect(res.body).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: expect.any(String),
        requestId: res.headers['x-request-id'],
      });
    });

    it('returns a generic 500 without stack traces or internals', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/__fixtures/crash')
        .expect(500);
      expect(res.body).toEqual({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId: expect.any(String),
      });
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|db\.ts|stack/);
    });

    it('rejects malformed JSON with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/__fixtures/echo')
        .set('Content-Type', 'application/json')
        .send('{"name":')
        .expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
    });
  });

  describe('validation', () => {
    it('accepts a valid body and wraps it in the envelope', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/__fixtures/echo')
        .send({ name: 'Laptop', amount: '1750000.00' })
        .expect(201);
      expect(res.body.data).toEqual({ name: 'Laptop', amount: '1750000.00' });
    });

    it('returns 400 VALIDATION_ERROR with field details', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/__fixtures/echo')
        .send({ name: '', amount: 1750000.5, total: '1' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(
        res.body.details.map((d: { field: string }) => d.field).sort(),
      ).toEqual(['amount', 'name', 'total']);
    });
  });

  describe('pagination', () => {
    it('applies defaults and returns pagination meta', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/__fixtures/items')
        .expect(200);
      expect(res.body).toMatchObject({
        data: [{ id: 'a' }],
        meta: { pagination: { page: 1, limit: 20, total: 41, totalPages: 3 } },
      });
    });

    it.each(['page=0', 'limit=101', 'limit=abc', 'unknown=1'])(
      'rejects ?%s with 400',
      async (qs) => {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/__fixtures/items?${qs}`)
          .expect(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      },
    );
  });

  describe('CORS', () => {
    it('allows the configured frontend origin', async () => {
      const res = await request(app.getHttpServer())
        .options('/api/v1/health')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET');
      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );
    });

    it('does not allow other origins', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'https://evil.example');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('Swagger', () => {
    it('publishes the OpenAPI document with the health endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      expect(res.body.info.title).toBe('ElectroCore EBMS API');
      expect(res.body.paths['/api/v1/health']).toBeDefined();
    });
  });
});
