import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
} from './permissions';

const role = (key: string) => ROLE_DEFINITIONS.find((r) => r.key === key)!;
const WRITE_LIKE =
  /:(write|create|adjust|transfer|receive|approve|return|discount|access_all)$/;

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
