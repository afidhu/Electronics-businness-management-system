import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
} from './permissions';

const role = (key: string) => ROLE_DEFINITIONS.find((r) => r.key === key)!;
const WRITE_LIKE =
  /:(write|create|adjust|transfer|receive|approve|return|discount|access_all|price)$/;

describe('permission matrix (ADR-016)', () => {
  it('defines exactly the seven approved roles', () => {
    expect(ROLE_DEFINITIONS.map((r) => r.key)).toEqual([...ROLE_KEYS]);
    expect(ROLE_KEYS).toEqual([
      'SYSTEM_ADMIN',
      'MANAGER',
      'INVENTORY_OFFICER',
      'PROCUREMENT_OFFICER',
      'CASHIER',
      'TECHNICIAN',
      'AUDITOR',
    ]);
  });

  it('uses only catalogued permission keys, without duplicates, all described', () => {
    for (const r of ROLE_DEFINITIONS) {
      expect(new Set(r.permissions).size).toBe(r.permissions.length);
      for (const p of r.permissions) expect(ALL_PERMISSIONS).toContain(p);
    }
    for (const p of ALL_PERMISSIONS) {
      expect(p).toMatch(/^[a-z]+:[a-z_]+$/);
      expect(PERMISSION_DESCRIPTIONS[p]).toBeTruthy();
    }
  });

  it('SYSTEM_ADMIN has every permission, including all-branch access', () => {
    expect([...role('SYSTEM_ADMIN').permissions].sort()).toEqual(
      [...ALL_PERMISSIONS].sort(),
    );
  });

  it('only SYSTEM_ADMIN has all-branch access and user/branch administration', () => {
    for (const r of ROLE_DEFINITIONS.filter((x) => x.key !== 'SYSTEM_ADMIN')) {
      expect(r.permissions).not.toContain(PERMISSIONS.BRANCHES_ACCESS_ALL);
      expect(r.permissions).not.toContain(PERMISSIONS.USERS_WRITE);
      expect(r.permissions).not.toContain(PERMISSIONS.BRANCHES_WRITE);
    }
  });

  it('only MANAGER and SYSTEM_ADMIN can approve POs, discount and return (decisions 16 Nov 2026)', () => {
    for (const p of [
      PERMISSIONS.PROCUREMENT_APPROVE,
      PERMISSIONS.SALES_DISCOUNT,
      PERMISSIONS.SALES_RETURN,
    ]) {
      const holders = ROLE_DEFINITIONS.filter((r) =>
        r.permissions.includes(p),
      ).map((r) => r.key);
      expect(holders.sort()).toEqual(['MANAGER', 'SYSTEM_ADMIN']);
    }
  });

  it('catalogue:price is held by exactly MANAGER and SYSTEM_ADMIN (D5)', () => {
    const holders = ROLE_DEFINITIONS.filter((r) =>
      r.permissions.includes(PERMISSIONS.CATALOGUE_PRICE),
    ).map((r) => r.key);
    expect(holders.sort()).toEqual(['MANAGER', 'SYSTEM_ADMIN']);
  });

  it('catalogue:cost_read is held by every role except CASHIER and TECHNICIAN (D4)', () => {
    const without = ROLE_DEFINITIONS.filter(
      (r) => !r.permissions.includes(PERMISSIONS.CATALOGUE_COST_READ),
    ).map((r) => r.key);
    expect(without.sort()).toEqual(['CASHIER', 'TECHNICIAN']);
  });

  it('the Module 3 change added exactly the two approved permissions and grants', () => {
    // Snapshot of every grant; any accidental change to another role fails here.
    const grants = Object.fromEntries(
      ROLE_DEFINITIONS.map((r) => [r.key, r.permissions.length]),
    );
    expect(grants).toEqual({
      SYSTEM_ADMIN: 32,
      MANAGER: 19,
      INVENTORY_OFFICER: 10,
      PROCUREMENT_OFFICER: 7,
      CASHIER: 8,
      TECHNICIAN: 7,
      AUDITOR: 14,
    });
  });

  it('settings:write is held by SYSTEM_ADMIN only (Module 6, S1)', () => {
    const holders = ROLE_DEFINITIONS.filter((r) =>
      r.permissions.includes(PERMISSIONS.SETTINGS_WRITE),
    ).map((r) => r.key);
    expect(holders).toEqual(['SYSTEM_ADMIN']);
  });

  it('AUDITOR is strictly read-only', () => {
    const auditor = role('AUDITOR');
    expect(auditor.permissions.filter((p) => WRITE_LIKE.test(p))).toEqual([]);
    expect(auditor.permissions).toContain(PERMISSIONS.AUDIT_READ);
  });

  it('CASHIER and TECHNICIAN are limited to one branch; others are multi-branch', () => {
    expect(role('CASHIER').maxBranches).toBe(1);
    expect(role('TECHNICIAN').maxBranches).toBe(1);
    for (const k of [
      'MANAGER',
      'INVENTORY_OFFICER',
      'PROCUREMENT_OFFICER',
      'AUDITOR',
    ]) {
      expect(role(k).maxBranches).toBeNull();
    }
  });

  it.each([
    [
      'CASHIER',
      ['sales:create', 'customers:write', 'sales:read'],
      ['users:read', 'inventory:adjust', 'catalogue:write'],
    ],
    [
      'INVENTORY_OFFICER',
      ['catalogue:write', 'inventory:receive', 'inventory:adjust'],
      ['sales:create', 'users:read'],
    ],
    [
      'PROCUREMENT_OFFICER',
      ['procurement:write', 'inventory:receive'],
      ['procurement:approve', 'sales:create'],
    ],
    [
      'MANAGER',
      [
        'reports:sales',
        'procurement:approve',
        'audit:read',
        'users:read',
        'sales:discount',
        'sales:return',
      ],
      ['users:write', 'sales:create'],
    ],
    [
      'TECHNICIAN',
      ['warranty:write', 'repairs:write'],
      ['sales:create', 'inventory:adjust'],
    ],
  ])('%s has its duties and nothing outside them', (key, has, hasNot) => {
    for (const p of has) expect(role(key).permissions).toContain(p);
    for (const p of hasNot) expect(role(key).permissions).not.toContain(p);
  });
});
