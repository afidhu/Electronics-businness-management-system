import { Prisma } from '../generated/prisma/client';
import {
  formatReceiptNumber,
  ledgerUnitCost,
  priceCart,
  roundMoney,
  settlePayments,
} from './pricing';

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

describe('settlePayments (S4)', () => {
  const total = D('2100400');

  it('accepts the demo split: mobile money + cash with change', () => {
    const r = settlePayments(total, [
      {
        method: 'MOBILE_MONEY',
        amount: '1500000',
        reference: ' MP26111712AB ',
      },
      { method: 'CASH', amount: '600400', amountTendered: '601000' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changeGiven.toFixed(2)).toBe('600.00');
    expect(r.payments[0].reference).toBe('MP26111712AB');
    expect(r.payments[1].amountTendered!.toFixed(2)).toBe('601000.00');
  });

  it('exact single card payment, no reference needed; no change', () => {
    const r = settlePayments(total, [{ method: 'CARD', amount: '2100400.00' }]);
    expect(r.ok && r.changeGiven.toFixed(2)).toBe('0.00');
  });

  it.each([
    [
      'underpayment',
      [{ method: 'CASH' as const, amount: '2100399.99' }],
      'payments',
      true,
    ],
    [
      'overpayment',
      [{ method: 'CARD' as const, amount: '2100400.01' }],
      'payments',
      true,
    ],
    [
      'zero amount',
      [{ method: 'CASH' as const, amount: '0' }],
      'payments.0.amount',
      false,
    ],
    [
      'tender below amount',
      [
        {
          method: 'CASH' as const,
          amount: '2100400',
          amountTendered: '2100000',
        },
      ],
      'payments.0.amountTendered',
      false,
    ],
    [
      'tender on card',
      [
        {
          method: 'CARD' as const,
          amount: '2100400',
          amountTendered: '2200000',
        },
      ],
      'payments.0.amountTendered',
      false,
    ],
    [
      'mobile money without reference',
      [{ method: 'MOBILE_MONEY' as const, amount: '2100400', reference: '  ' }],
      'payments.0.reference',
      false,
    ],
    [
      'bank transfer without reference',
      [{ method: 'BANK_TRANSFER' as const, amount: '2100400' }],
      'payments.0.reference',
      false,
    ],
  ])('rejects %s', (_l, payments, field, mismatch) => {
    const r = settlePayments(total, payments);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.field).toBe(field);
    expect(r.mismatch).toBe(mismatch);
  });
});

describe('formatReceiptNumber (S5) and ledgerUnitCost', () => {
  it('formats RCT-{BRANCH}-{YYYY}-{NNNNNN}', () => {
    expect(formatReceiptNumber('BR-A', '2026', 7)).toBe('RCT-BR-A-2026-000007');
    expect(() => formatReceiptNumber('BR-A', '2026', 0)).toThrow();
    expect(() => formatReceiptNumber('BR-A', '2026', 1_000_000)).toThrow();
  });

  it('rounds the 4-dp WAC half-up for the 2-dp ledger column', () => {
    expect(ledgerUnitCost(D('1400000.0050')).toFixed(2)).toBe('1400000.01');
    expect(ledgerUnitCost(D('8000.0049')).toFixed(2)).toBe('8000.00');
  });
});
