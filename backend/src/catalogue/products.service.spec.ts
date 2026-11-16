import { PERMISSIONS } from '../access/permissions';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { AppConfigService } from '../config/app-config.service';
import { Prisma } from '../generated/prisma/client';
import { changedFields } from './change-set';
import {
  assertImmutableUnchanged,
  ProductsService,
  trackingPolicy,
} from './products.service';

const user = (permissions: string[]): AuthenticatedUser => ({
  id: 'u',
  email: 'u@test',
  fullName: 'U',
  roleKey: 'CASHIER',
  permissions: new Set(permissions),
  branchIds: [],
  allBranches: false,
});

const row = {
  id: 'p1',
  sku: 'HP-1',
  name: 'Laptop',
  description: null,
  trackingMode: 'SERIALIZED',
  identifierType: 'SERIAL',
  identifiersPerUnit: 1,
  costPrice: new Prisma.Decimal('1450000'),
  sellingPrice: new Prisma.Decimal('1750000.5'),
  reorderLevel: 2,
  specifications: { ram: '16GB' },
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  category: { id: 'c', name: 'Laptops', isActive: true },
  brand: { id: 'b', name: 'HP', isActive: true },
} as never;

describe('ProductsService.toResponse (cost visibility, D4)', () => {
  const svc = new ProductsService(
    {} as never,
    {} as never,
    {
      currency: 'TZS',
    } as AppConfigService,
  );

  it('includes costPrice only with catalogue:cost_read', () => {
    const withCost = svc.toResponse(
      row,
      user([PERMISSIONS.CATALOGUE_COST_READ]),
    );
    expect(withCost.costPrice).toBe('1450000.00');
    const cashier = svc.toResponse(row, user([PERMISSIONS.CATALOGUE_READ]));
    expect(cashier).not.toHaveProperty('costPrice');
    expect(JSON.stringify(cashier)).not.toContain('1450000');
  });

  it('formats money, currency and the tax-exclusive flag', () => {
    const r = svc.toResponse(row, user([]));
    expect(r).toMatchObject({
      sellingPrice: '1750000.50',
      currency: 'TZS',
      priceIncludesTax: false,
      category: { id: 'c', name: 'Laptops' },
    });
  });
});

describe('trackingPolicy', () => {
  it('requires an identifier type for SERIALIZED and defaults to 1 per unit', () => {
    expect(
      trackingPolicy({ trackingMode: 'SERIALIZED', identifierType: 'IMEI' }),
    ).toEqual({
      identifierType: 'IMEI',
      identifiersPerUnit: 1,
    });
    expect(
      trackingPolicy({
        trackingMode: 'SERIALIZED',
        identifierType: 'IMEI',
        identifiersPerUnit: 2,
      }),
    ).toEqual({ identifierType: 'IMEI', identifiersPerUnit: 2 });
    expect(() => trackingPolicy({ trackingMode: 'SERIALIZED' })).toThrow(
      AppException,
    );
  });

  it('forbids an identifier policy on QUANTITY products', () => {
    expect(trackingPolicy({ trackingMode: 'QUANTITY' })).toEqual({
      identifierType: null,
      identifiersPerUnit: null,
    });
    expect(() =>
      trackingPolicy({ trackingMode: 'QUANTITY', identifierType: 'SERIAL' }),
    ).toThrow(AppException);
    expect(() =>
      trackingPolicy({ trackingMode: 'QUANTITY', identifiersPerUnit: 1 }),
    ).toThrow(AppException);
  });
});

describe('assertImmutableUnchanged (D9)', () => {
  const current = {
    sku: 'HP-1',
    trackingMode: 'SERIALIZED',
    identifierType: 'SERIAL',
    identifiersPerUnit: 1,
  };

  it('allows bodies that omit or repeat immutable values', () => {
    expect(() =>
      assertImmutableUnchanged({ name: 'x' }, current),
    ).not.toThrow();
    expect(() =>
      assertImmutableUnchanged(
        { sku: ' hp-1 ', trackingMode: 'SERIALIZED' },
        current,
      ),
    ).not.toThrow();
  });

  it('rejects changes with IMMUTABLE_FIELD and lists the fields', () => {
    try {
      assertImmutableUnchanged(
        { sku: 'HP-2', trackingMode: 'QUANTITY' },
        current,
      );
      fail('expected rejection');
    } catch (e) {
      expect((e as AppException).code).toBe(ErrorCode.IMMUTABLE_FIELD);
      expect((e as AppException).details?.map((d) => d.field)).toEqual([
        'sku',
        'trackingMode',
      ]);
    }
  });
});

describe('changedFields (audit old → new)', () => {
  it('records only changed fields, with Decimals as 2-decimal strings', () => {
    expect(
      changedFields(
        {
          sellingPrice: new Prisma.Decimal('100'),
          costPrice: new Prisma.Decimal('80'),
          name: 'a',
        },
        {
          sellingPrice: new Prisma.Decimal('90.5'),
          costPrice: new Prisma.Decimal('80.00'),
          name: 'a',
        },
        ['sellingPrice', 'costPrice', 'name'],
      ),
    ).toEqual({ sellingPrice: { from: '100.00', to: '90.50' } });
  });

  it('treats undefined as null and compares objects by value', () => {
    expect(changedFields({ d: undefined }, { d: null }, ['d'])).toEqual({});
    expect(changedFields({ s: { a: 1 } }, { s: { a: 2 } }, ['s'])).toEqual({
      s: { from: { a: 1 }, to: { a: 2 } },
    });
  });
});
