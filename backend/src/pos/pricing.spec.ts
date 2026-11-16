import { Prisma } from '../generated/prisma/client';
import { priceCart, roundMoney } from './pricing';

const D = (v: string) => new Prisma.Decimal(v);

describe('roundMoney (S2: half-up, 2 decimals)', () => {
  it.each([
    ['0.005', '0.01'],
    ['0.004', '0.00'],
    ['1.8054', '1.81'],
    ['1.8049', '1.80'],
    ['2.345', '2.35'],
    ['320400', '320400.00'],
  ])('%s → %s', (input, expected) => {
    expect(roundMoney(D(input)).toFixed(2)).toBe(expected);
  });
});

describe('priceCart', () => {
  it('prices the demo cart: 1,780,000 + 18% VAT = 2,100,400', () => {
    const r = priceCart(
      [
        { quantity: 1, unitPrice: '1750000' },
        { quantity: 2, unitPrice: '15000' },
      ],
      '18',
    )!;
    expect(r.lines.map((l) => l.lineTotal.toFixed(2))).toEqual([
      '1750000.00',
      '30000.00',
    ]);
    expect(r.subtotal.toFixed(2)).toBe('1780000.00');
    expect(r.taxAmount.toFixed(2)).toBe('320400.00');
    expect(r.total.toFixed(2)).toBe('2100400.00');
  });

  it('rounds tax on the subtotal, not per line', () => {
    // per line: 3 × round(0.18 × 0.03) = 3 × 0.01 = 0.03; on subtotal: round(0.0162) = 0.02
    const r = priceCart(
      [
        { quantity: 1, unitPrice: '0.03' },
        { quantity: 1, unitPrice: '0.03' },
        { quantity: 1, unitPrice: '0.03' },
      ],
      '18',
    )!;
    expect(r.subtotal.toFixed(2)).toBe('0.09');
    expect(r.taxAmount.toFixed(2)).toBe('0.02');
    expect(r.total.toFixed(2)).toBe('0.11');
  });

  it('half-up on exact halves and fractional rates', () => {
    expect(
      priceCart([{ quantity: 1, unitPrice: '10.03' }], '18')!.taxAmount.toFixed(
        2,
      ),
    ).toBe('1.81'); // 1.8054
    expect(
      priceCart([{ quantity: 1, unitPrice: '0.10' }], '5')!.taxAmount.toFixed(
        2,
      ),
    ).toBe('0.01'); // 0.005
    expect(
      priceCart(
        [{ quantity: 3, unitPrice: '33.33' }],
        '16.5',
      )!.taxAmount.toFixed(2),
    ).toBe('16.50'); // 16.49835
  });

  it('0% VAT yields no tax; floating-point never involved', () => {
    const r = priceCart([{ quantity: 3, unitPrice: '0.1' }], '0')!;
    expect([
      r.subtotal.toFixed(2),
      r.taxAmount.toFixed(2),
      r.total.toFixed(2),
    ]).toEqual(['0.30', '0.00', '0.30']);
  });

  it('returns null on Decimal(14,2) overflow and rejects invalid input', () => {
    expect(
      priceCart([{ quantity: 1000, unitPrice: '999999999999.99' }], '0'),
    ).toBeNull();
    expect(() => priceCart([{ quantity: 0, unitPrice: '1' }], '18')).toThrow();
    expect(() =>
      priceCart([{ quantity: 1.5, unitPrice: '1' }], '18'),
    ).toThrow();
    expect(() => priceCart([{ quantity: 1, unitPrice: '1' }], '101')).toThrow();
  });
});
