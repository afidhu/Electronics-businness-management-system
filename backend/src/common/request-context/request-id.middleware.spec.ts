import type { Response } from 'express';
import {
  RequestWithId,
  requestIdMiddleware,
  resolveRequestId,
} from './request-id.middleware';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('reuses a safe incoming ID', () => {
    expect(resolveRequestId('proxy-abc-12345')).toBe('proxy-abc-12345');
  });

  it.each([
    undefined,
    '',
    'short',
    'x'.repeat(65),
    'bad id with spaces',
    'inject\nnewline',
    ['array-value-123'],
  ])('generates a UUID for unsafe input %p', (value) => {
    expect(resolveRequestId(value)).toMatch(UUID);
  });
});

describe('requestIdMiddleware', () => {
  it('attaches the ID to the request and echoes it in X-Request-Id', () => {
    const req = {
      headers: { 'x-request-id': 'client-req-0001' },
    } as unknown as RequestWithId;
    const res = { setHeader: jest.fn() } as unknown as Response;
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBe('client-req-0001');
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      'client-req-0001',
    );
    expect(next).toHaveBeenCalled();
  });
});
