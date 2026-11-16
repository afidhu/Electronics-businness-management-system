import { ROLE_DEFINITIONS } from '../access/permissions';
import {
  computeLines,
  duplicateProductIds,
  formatPoReference,
  isActionAllowed,
  isSelfApproval,
  isValidTin,
  MAX_MONEY,
  normaliseTin,
  PO_REFERENCE_PATTERN,
  poSequenceScope,
  type PurchaseAction,
  type PurchaseStatusValue,
} from './procurement-rules';

const ALL: PurchaseStatusValue[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
];

describe('status transitions (P2, P5)', () => {
  const expected: Record<PurchaseAction, PurchaseStatusValue[]> = {
    edit: ['DRAFT'],
    submit: ['DRAFT'],
    approve: ['SUBMITTED'],
    reject: ['SUBMITTED'],
    reopen: ['REJECTED'],
    cancel: ['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'],
  };

  it.each(Object.entries(expected))(
    '%s is allowed exactly from %p',
    (action, from) => {
      for (const status of ALL) {
        expect(isActionAllowed(action as PurchaseAction, status)).toBe(
          from.includes(status),
        );
      }
    },
  );

  it('Module 4 never allows anything on received, partially received or cancelled orders except as listed', () => {
    for (const action of Object.keys(expected) as PurchaseAction[]) {
      expect(isActionAllowed(action, 'RECEIVED')).toBe(false);
      expect(isActionAllowed(action, 'PARTIALLY_RECEIVED')).toBe(false);
      expect(isActionAllowed(action, 'CANCELLED')).toBe(false);
    }
  });
});

describe('separation of duties (P3)', () => {
  const order = { createdById: 'creator', submittedById: 'submitter' };

  it('blocks the creator and the submitter, whatever their role', () => {
    expect(isSelfApproval('creator', order)).toBe(true);
    expect(isSelfApproval('submitter', order)).toBe(true);
    expect(
      isSelfApproval('creator', {
        createdById: 'creator',
        submittedById: 'creator',
      }),
    ).toBe(true);
  });

  it('blocks anyone who submitted an earlier cycle (reject → reopen → resubmit)', () => {
    expect(isSelfApproval('old-submitter', order, ['old-submitter'])).toBe(
      true,
    );
  });

  it('allows an uninvolved approver', () => {
    expect(isSelfApproval('manager', order, ['old-submitter'])).toBe(false);
  });
});

describe('line maths (exact decimals, P7–P9)', () => {
  it('computes line totals and subtotal without floating-point error', () => {
    const r = computeLines([
      { productId: 'a', quantity: 3, unitCost: '0.10' },
      { productId: 'b', quantity: 10, unitCost: '1400000' },
    ])!;
    expect(r.lines.map((l) => [l.lineNumber, l.lineTotal.toFixed(2)])).toEqual([
      [1, '0.30'],
      [2, '14000000.00'],
    ]);
    expect(r.subtotal.toFixed(2)).toBe('14000000.30');
  });

  it('returns null when a total would overflow Decimal(14,2)', () => {
    expect(
      computeLines([
        { productId: 'a', quantity: 1_000_000, unitCost: '999999999' },
      ]),
    ).toBeNull();
    expect(
      computeLines([
        { productId: 'a', quantity: 1, unitCost: MAX_MONEY.toFixed(2) },
        { productId: 'b', quantity: 1, unitCost: '0.01' },
      ]),
    ).toBeNull();
  });

  it('finds duplicate products', () => {
    expect(
      duplicateProductIds([
        { productId: 'a', quantity: 1, unitCost: '1' },
        { productId: 'b', quantity: 1, unitCost: '1' },
        { productId: 'a', quantity: 2, unitCost: '1' },
      ]),
    ).toEqual(['a']);
  });
});

describe('PO references (P6)', () => {
  it('formats PO-{BRANCHCODE}-{YYYY}-{NNNNNN}', () => {
    expect(formatPoReference('DSM01', '2026', 14)).toBe('PO-DSM01-2026-000014');
    expect(formatPoReference('BR-A', '2027', 999999)).toBe(
      'PO-BR-A-2027-999999',
    );
    expect(
      PO_REFERENCE_PATTERN.test(formatPoReference('DSM01', '2026', 1)),
    ).toBe(true);
    expect(poSequenceScope('DSM01', '2026')).toBe('PO:DSM01:2026');
  });

  it.each([0, -1, 1_000_000, 1.5])('rejects sequence %p', (n) => {
    expect(() => formatPoReference('DSM01', '2026', n)).toThrow(/out of range/);
  });
});

describe('TIN (P11)', () => {
  it('normalises dashes/spaces and requires 9 digits', () => {
    expect(normaliseTin('123-456-789')).toBe('123456789');
    expect(isValidTin(normaliseTin(' 123 456 789 '))).toBe(true);
    expect(isValidTin('12345678')).toBe(false);
    expect(isValidTin('12345678A')).toBe(false);
  });
});

describe('permission invariants used by procurement', () => {
  it('every procurement:read holder can see cost prices (order lines show unit costs)', () => {
    for (const r of ROLE_DEFINITIONS) {
      if (r.permissions.includes('procurement:read')) {
        expect([r.key, r.permissions.includes('catalogue:cost_read')]).toEqual([
          r.key,
          true,
        ]);
      }
    }
  });

  it('PROCUREMENT_OFFICER can never approve; approvers are exactly MANAGER and SYSTEM_ADMIN', () => {
    const approvers = ROLE_DEFINITIONS.filter((r) =>
      r.permissions.includes('procurement:approve'),
    ).map((r) => r.key);
    expect(approvers.sort()).toEqual(['MANAGER', 'SYSTEM_ADMIN']);
  });
});
