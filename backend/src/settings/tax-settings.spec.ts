import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { Prisma } from '../generated/prisma/client';
import { TAX_RATE_PATTERN } from './dto/tax-setting.dto';
import { TaxSettingsService } from './tax-settings.service';

describe('VAT rate format (S1)', () => {
  it.each([
    '0',
    '0.0',
    '0.00',
    '18',
    '18.0',
    '18.00',
    '16.5',
    '99.99',
    '100',
    '100.00',
  ])('accepts %p', (v) => expect(TAX_RATE_PATTERN.test(v)).toBe(true));
  it.each([
    '-1',
    '100.01',
    '101',
    '18.555',
    '18.',
    '.5',
    'abc',
    '',
    ' 18',
    '018.00',
  ])('rejects %p', (v) => expect(TAX_RATE_PATTERN.test(v)).toBe(false));
});

describe('TaxSettingsService.requireActive (BR-20 sales guard)', () => {
  const svc = (active: unknown) =>
    new TaxSettingsService(
      { taxSetting: { findFirst: () => Promise.resolve(active) } } as never,
      {} as never,
    );

  it('blocks sales with 409 TAX_NOT_CONFIGURED when no rate exists', async () => {
    const err = (await svc(null)
      .requireActive()
      .catch((e: unknown) => e)) as AppException;
    expect(err).toBeInstanceOf(AppException);
    expect(err.getStatus()).toBe(409);
    expect(err.code).toBe(ErrorCode.TAX_NOT_CONFIGURED);
  });

  it('returns the active rate, including an explicit 0%', async () => {
    const zero = {
      id: 't',
      name: 'VAT',
      ratePercent: new Prisma.Decimal('0'),
      createdAt: new Date(),
    };
    await expect(svc(zero).requireActive()).resolves.toBe(zero);
  });
});
