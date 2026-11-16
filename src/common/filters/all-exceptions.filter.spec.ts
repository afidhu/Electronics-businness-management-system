import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { AllExceptionsFilter } from './all-exceptions.filter';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Invalid `prisma.x.create()` invocation: SELECT * FROM secret_table',
    { code, clientVersion: '7.10.1' },
  );
}

function mockHost(requestId = 'req-12345678') {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ requestId }),
      getResponse: () => res,
    }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeAll(() =>
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
  );
  afterAll(() => jest.restoreAllMocks());

  it('writes the documented error shape with the request ID', () => {
    const { host, res } = mockHost('abc-req-0001');
    filter.catch(new NotFoundException('Product not found'), host);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      statusCode: 404,
      code: ErrorCode.NOT_FOUND,
      message: 'Product not found',
      requestId: 'abc-req-0001',
    });
  });

  it('keeps the code, message and details of an AppException', () => {
    const body = filter.toErrorBody(
      new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [{ field: 'sku', messages: ['sku should not be empty'] }],
      ),
      'r',
    );
    expect(body).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      requestId: 'r',
      details: [{ field: 'sku', messages: ['sku should not be empty'] }],
    });
  });

  it.each([
    [new BadRequestException('bad'), 400, ErrorCode.BAD_REQUEST],
    [new ForbiddenException(), 403, ErrorCode.FORBIDDEN],
  ])('maps %p to status and fallback code', (exception, status, code) => {
    const body = filter.toErrorBody(exception, 'r');
    expect(body.statusCode).toBe(status);
    expect(body.code).toBe(code);
  });

  it.each([
    ['P2002', 409, ErrorCode.DUPLICATE_VALUE],
    ['P2003', 409, ErrorCode.REFERENCE_CONFLICT],
    ['P2025', 404, ErrorCode.NOT_FOUND],
  ])(
    'maps Prisma %s to %i %s without leaking SQL',
    (code, status, errorCode) => {
      const body = filter.toErrorBody(prismaError(code), 'r');
      expect(body.statusCode).toBe(status);
      expect(body.code).toBe(errorCode);
      expect(JSON.stringify(body)).not.toMatch(/secret_table|prisma\.x/);
    },
  );

  it('turns unknown Prisma codes and arbitrary errors into a generic 500', () => {
    for (const error of [
      prismaError('P9999'),
      new Error('db password is hunter2'),
      'boom',
    ]) {
      const body = filter.toErrorBody(error, 'r');
      expect(body).toEqual({
        statusCode: 500,
        code: ErrorCode.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
        requestId: 'r',
      });
    }
  });

  it('hides the message of a 5xx HttpException', () => {
    const body = filter.toErrorBody(
      new InternalServerErrorException('stack details'),
      'r',
    );
    expect(body.message).toBe('An unexpected error occurred');
  });

  it('maps body-parser errors', () => {
    expect(
      filter.toErrorBody({ type: 'entity.parse.failed' }, 'r').statusCode,
    ).toBe(400);
    expect(filter.toErrorBody({ type: 'entity.too.large' }, 'r')).toMatchObject(
      {
        statusCode: 413,
        code: ErrorCode.PAYLOAD_TOO_LARGE,
      },
    );
  });

  it('logs 5xx errors server-side with the request ID', () => {
    const { host } = mockHost('log-req-0001');
    filter.catch(new Error('kaboom'), host);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('requestId=log-req-0001'),
      expect.stringContaining('kaboom'),
    );
  });
});
