import { Prisma } from '../generated/prisma/client';
import {
  canonicalJson,
  formatGrnReference,
  GRN_REFERENCE_PATTERN,
  isBlockedReceiver,
  prepareSerialUnits,
  repeatedValues,
  requestHash,
  weightedAverageCost,
} from './inventory-rules';

describe('weighted average cost (ADR-029, I1)', () => {
  it('uses the receipt cost when there is no stock', () => {
    expect(weightedAverageCost(0, null, 10, '1400000').toFixed(4)).toBe(
      '1400000.0000',
    );
    expect(weightedAverageCost(0, '999', 1, '5').toFixed(4)).toBe('5.0000'); // stale avg ignored at 0 stock
  });

  it('blends existing stock with the new receipt', () => {
    // 10 @ 100 + 30 @ 120 = (1000 + 3600) / 40 = 115
    expect(weightedAverageCost(10, '100', 30, '120').toFixed(4)).toBe(
      '115.0000',
    );
  });

  it('rounds half-up to 4 decimals without floating-point error', () => {
    // (1 × 0.1 + 2 × 0.2) / 3 = 0.1666…7
    expect(weightedAverageCost(1, '0.1', 2, '0.2').toFixed(4)).toBe('0.1667');
    // (2 × 10 + 1 × 10.01) / 3 = 10.00333… → 10.0033
    expect(
      weightedAverageCost(2, new Prisma.Decimal('10'), 1, '10.01').toFixed(4),
    ).toBe('10.0033');
  });

  it('sequence: receipts change the average, order matters only through quantities', () => {
    let avg = weightedAverageCost(0, null, 5, '200');
    avg = weightedAverageCost(5, avg, 5, '300');
    expect(avg.toFixed(4)).toBe('250.0000');
    avg = weightedAverageCost(10, avg, 10, '100');
    expect(avg.toFixed(4)).toBe('175.0000');
  });

  it('rejects invalid quantities', () => {
    expect(() => weightedAverageCost(0, null, 0, '1')).toThrow();
    expect(() => weightedAverageCost(-1, null, 1, '1')).toThrow();
    expect(() => weightedAverageCost(0, null, 1.5, '1')).toThrow();
  });
});

describe('BR-14 receiver check (I4, I22)', () => {
  const po = { createdById: 'c', submittedById: 's', approvedById: 'a' };
  it('blocks creator, current submitter, approver and earlier submitters', () => {
    for (const actor of ['c', 's', 'a'])
      expect(isBlockedReceiver(actor, po)).toBe(true);
    expect(isBlockedReceiver('old', po, ['old'])).toBe(true);
  });
  it('allows anyone else', () => {
    expect(isBlockedReceiver('inventory-officer', po, ['old'])).toBe(false);
  });
});

describe('idempotency hash', () => {
  it('ignores key order but not values or array order', () => {
    const a = { items: [{ q: 1, id: 'x' }], ref: 'r' };
    const b = { ref: 'r', items: [{ id: 'x', q: 1 }] };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(requestHash('po1', a)).toBe(requestHash('po1', b));
    expect(requestHash('po1', a)).not.toBe(requestHash('po2', a));
    expect(requestHash('po1', a)).not.toBe(
      requestHash('po1', { ...a, ref: 's' }),
    );
    expect(requestHash('po1', { l: [1, 2] })).not.toBe(
      requestHash('po1', { l: [2, 1] }),
    );
    expect(requestHash('x', {})).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('serialized unit preparation', () => {
  it('normalises and accepts valid IMEIs (dual-SIM)', () => {
    const r = prepareSerialUnits(
      'IMEI',
      2,
      1,
      [{ identifiers: ['35-209900 176148 1', '490154203237518'] }],
      'items.0',
    );
    expect(r.countProblems).toEqual([]);
    expect(r.formatProblems).toEqual([]);
    expect(r.units).toEqual([['352099001761481', '490154203237518']]);
  });

  it('reports count mismatches and invalid identifiers with field paths', () => {
    const r = prepareSerialUnits(
      'IMEI',
      1,
      2,
      [{ identifiers: ['352099001761482'] }],
      'items.0',
    );
    expect(r.countProblems.map((p) => p.field)).toEqual(['items.0.units']);
    expect(r.formatProblems[0]).toMatchObject({
      field: 'items.0.units.0.identifiers.0',
    });
    const s = prepareSerialUnits(
      'SERIAL',
      1,
      1,
      [{ identifiers: ['a', 'b'] }],
      'items.1',
    );
    expect(s.countProblems[0].field).toBe('items.1.units.0.identifiers');
    expect(s.formatProblems).toHaveLength(2);
  });

  it('finds repeated values after normalisation', () => {
    expect(repeatedValues(['ABC1', 'X', 'ABC1'])).toEqual(['ABC1']);
    const r = prepareSerialUnits(
      'SERIAL',
      1,
      2,
      [{ identifiers: ['5cg1234'] }, { identifiers: [' 5CG1234 '] }],
      'i',
    );
    expect(repeatedValues(r.units.flat())).toEqual(['5CG1234']);
  });
});

describe('GRN references', () => {
  it('formats and validates', () => {
    expect(formatGrnReference('BR-A', '2026', 3)).toBe('GRN-BR-A-2026-000003');
    expect(
      GRN_REFERENCE_PATTERN.test(formatGrnReference('DSM01', '2026', 999999)),
    ).toBe(true);
    expect(() => formatGrnReference('X1', '2026', 0)).toThrow();
  });
});
