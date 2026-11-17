/**
 * Permission catalogue and role → permission matrix (ADR-016,
 * docs 02-requirements/06-permission-matrix.md). This file is the single
 * source of truth: the database is seeded from it (`npm run db:seed`) and
 * code checks permission KEYS, never role names.
 */

export const PERMISSIONS = {
  // Identity & administration
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  ROLES_READ: 'roles:read',
  BRANCHES_READ: 'branches:read',
  BRANCHES_WRITE: 'branches:write',
  /** Access every branch without an assignment (system administrators). */
  BRANCHES_ACCESS_ALL: 'branches:access_all',
  AUDIT_READ: 'audit:read',
  // Catalogue
  CATALOGUE_READ: 'catalogue:read',
  CATALOGUE_WRITE: 'catalogue:write',
  /** Change prices of EXISTING products (Module 3, D5). */
  CATALOGUE_PRICE: 'catalogue:price',
  /** See cost prices in API responses (Module 3, D4). */
  CATALOGUE_COST_READ: 'catalogue:cost_read',
  // Inventory
  INVENTORY_READ: 'inventory:read',
  INVENTORY_WRITE: 'inventory:write',
  INVENTORY_RECEIVE: 'inventory:receive',
  INVENTORY_ADJUST: 'inventory:adjust',
  INVENTORY_TRANSFER: 'inventory:transfer',
  // Procurement
  PROCUREMENT_READ: 'procurement:read',
  PROCUREMENT_WRITE: 'procurement:write',
  PROCUREMENT_APPROVE: 'procurement:approve',
  // Customers & sales
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_WRITE: 'customers:write',
  SALES_READ: 'sales:read',
  SALES_CREATE: 'sales:create',
  SALES_RETURN: 'sales:return',
  SALES_DISCOUNT: 'sales:discount',
  // Warranty & repairs
  WARRANTY_READ: 'warranty:read',
  WARRANTY_WRITE: 'warranty:write',
  REPAIRS_READ: 'repairs:read',
  REPAIRS_WRITE: 'repairs:write',
  // Reports
  REPORTS_SALES: 'reports:sales',
  // Settings (Module 6)
  /** Change organisation settings, e.g. the VAT rate. SYSTEM_ADMIN only (S1). */
  SETTINGS_WRITE: 'settings:write',
  REPORTS_INVENTORY: 'reports:inventory',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  'users:read': 'View staff user accounts',
  'users:write': 'Create, update, deactivate users; assign roles and branches',
  'roles:read': 'View roles and their permissions',
  'branches:read': 'View branches',
  'branches:write': 'Create and update branches',
  'branches:access_all': 'Access all branches without explicit assignment',
  'audit:read': 'View audit history',
  'catalogue:read': 'View categories, brands and products',
  'catalogue:write':
    'Create categories, brands and products (incl. initial prices); update non-price fields',
  'catalogue:price': 'Change cost/selling prices of existing products',
  'catalogue:cost_read': 'See product cost prices',
  'inventory:read': 'View stock balances, serialized units and movements',
  'inventory:write': 'Maintain serialized unit records',
  'inventory:receive': 'Receive goods against purchase orders',
  'inventory:adjust': 'Record stock adjustments (with reason)',
  'inventory:transfer': 'Create and receive stock transfers',
  'procurement:read': 'View suppliers and purchase orders',
  'procurement:write': 'Create and update suppliers and purchase orders',
  'procurement:approve': 'Submit/approve and cancel purchase orders',
  'customers:read': 'View customers',
  'customers:write': 'Create and update customers',
  'sales:read': 'View sales and receipts',
  'sales:create': 'Complete POS sales and record payments',
  'sales:return': 'Process returns/refunds',
  'sales:discount': 'Apply discounts at checkout',
  'warranty:read': 'Look up warranties',
  'warranty:write': 'Register and update warranty claims',
  'repairs:read': 'View repair jobs (later release)',
  'repairs:write': 'Manage repair jobs (later release)',
  'reports:sales': 'View sales reports and dashboard',
  'settings:write': 'Change organisation settings such as the VAT rate',
  'reports:inventory': 'View inventory reports',
};

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionKey[];

export const ROLE_KEYS = [
  'SYSTEM_ADMIN',
  'MANAGER',
  'INVENTORY_OFFICER',
  'PROCUREMENT_OFFICER',
  'CASHIER',
  'TECHNICIAN',
  'AUDITOR',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  /** Max branch assignments; null = unlimited (ignored with branches:access_all). */
  maxBranches: number | null;
  permissions: PermissionKey[];
}

const P = PERMISSIONS;

/** Every `*:read`-style permission (no writes) — basis for the AUDITOR role. */
const READ_ONLY: PermissionKey[] = [
  P.USERS_READ,
  P.ROLES_READ,
  P.BRANCHES_READ,
  P.AUDIT_READ,
  P.CATALOGUE_READ,
  P.CATALOGUE_COST_READ,
  P.INVENTORY_READ,
  P.PROCUREMENT_READ,
  P.CUSTOMERS_READ,
  P.SALES_READ,
  P.WARRANTY_READ,
  P.REPAIRS_READ,
  P.REPORTS_SALES,
  P.REPORTS_INVENTORY,
];

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: 'SYSTEM_ADMIN',
    name: 'System Administrator',
    description: 'Full system access across all branches',
    maxBranches: null,
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'MANAGER',
    name: 'Manager',
    description: 'Oversight, approvals and reporting for assigned branches',
    maxBranches: null,
    permissions: [
      // View staff of assigned branches only (no users:write) — decision 16 Nov 2026.
      P.USERS_READ,
      P.ROLES_READ,
      P.BRANCHES_READ,
      P.AUDIT_READ,
      P.CATALOGUE_READ,
      P.CATALOGUE_PRICE,
      P.CATALOGUE_COST_READ,
      P.INVENTORY_READ,
      P.INVENTORY_ADJUST,
      P.INVENTORY_TRANSFER,
      P.PROCUREMENT_READ,
      P.PROCUREMENT_APPROVE,
      P.CUSTOMERS_READ,
      P.SALES_READ,
      P.SALES_RETURN,
      P.SALES_DISCOUNT,
      P.WARRANTY_READ,
      P.REPORTS_SALES,
      P.REPORTS_INVENTORY,
    ],
  },
  {
    key: 'INVENTORY_OFFICER',
    name: 'Inventory Officer',
    description: 'Products and inventory operations for assigned branches',
    maxBranches: null,
    permissions: [
      P.BRANCHES_READ,
      P.CATALOGUE_READ,
      P.CATALOGUE_WRITE,
      P.CATALOGUE_COST_READ,
      P.INVENTORY_READ,
      P.INVENTORY_WRITE,
      P.INVENTORY_RECEIVE,
      P.INVENTORY_ADJUST,
      P.INVENTORY_TRANSFER,
      P.PROCUREMENT_READ,
    ],
  },
  {
    key: 'PROCUREMENT_OFFICER',
    name: 'Procurement Officer',
    description:
      'Suppliers, purchasing and stock receiving for assigned branches',
    maxBranches: null,
    permissions: [
      P.BRANCHES_READ,
      P.CATALOGUE_READ,
      P.CATALOGUE_COST_READ,
      P.INVENTORY_READ,
      P.INVENTORY_RECEIVE,
      P.PROCUREMENT_READ,
      P.PROCUREMENT_WRITE,
    ],
  },
  {
    key: 'CASHIER',
    name: 'Cashier / Salesperson',
    description: 'Customers, POS sales, payments and receipts at one branch',
    maxBranches: 1,
    permissions: [
      P.BRANCHES_READ,
      P.CATALOGUE_READ,
      P.INVENTORY_READ,
      P.CUSTOMERS_READ,
      P.CUSTOMERS_WRITE,
      P.SALES_READ,
      P.SALES_CREATE,
      P.WARRANTY_READ,
    ],
  },
  {
    key: 'TECHNICIAN',
    name: 'Technician',
    description:
      'Reserved for the future repair and warranty module; one branch',
    maxBranches: 1,
    permissions: [
      P.BRANCHES_READ,
      P.CATALOGUE_READ,
      P.CUSTOMERS_READ,
      P.WARRANTY_READ,
      P.WARRANTY_WRITE,
      P.REPAIRS_READ,
      P.REPAIRS_WRITE,
    ],
  },
  {
    key: 'AUDITOR',
    name: 'Auditor',
    description: 'Read-only access to records of assigned branches',
    maxBranches: null,
    permissions: READ_ONLY,
  },
];
