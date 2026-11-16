/**
 * Browser end-to-end fixture: builds a fresh demo branch through the PUBLIC
 * API only (no database access), against a backend started on the TEST
 * database. Every run uses a new branch code and new user emails, so runs
 * never collide and receipt numbers start at 000001.
 *
 * Requires a SYSTEM_ADMIN in the test database (see e2e/README.md).
 * The passwords here are throwaway TEST credentials for the test database.
 */

export const API = process.env.E2E_API ?? 'http://localhost:3100/api/v1';
export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'e2e.admin@ebms.test',
  password: process.env.E2E_ADMIN_PASSWORD ?? 'E2e-Admin-Pass-2026!',
};
export const USER_PASSWORD = 'E2e-User-Pass-2026!';

export interface Fixture {
  run: string;
  branch: { id: string; code: string };
  users: Record<
    'cashier' | 'manager' | 'inventory' | 'procurement' | 'auditor',
    { email: string; id: string }
  >;
  products: Record<'laptop' | 'phone' | 'cable', { id: string; sku: string }>;
  purchaseId: string;
  purchaseReference: string;
}

async function call<T>(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status} ${json.code ?? ''} ${json.message ?? ''}`,
    );
  }
  return json.data as T;
}

export async function loginToken(email: string, password: string) {
  const r = await call<{ accessToken: string }>('POST', '/auth/login', null, {
    email,
    password,
  });
  return r.accessToken;
}

export async function buildFixture(): Promise<Fixture> {
  const run = Math.random().toString(36).slice(2, 7).toUpperCase();
  const admin = await loginToken(ADMIN.email, ADMIN.password);
  const branch = await call<{ id: string; code: string }>(
    'POST',
    '/branches',
    admin,
    { code: `DSM-${run}`, name: `Dar es Salaam ${run}`, address: 'Samora Avenue, Dar es Salaam', phone: '+255222000111' },
  );

  const mkUser = async (role: string, name: string) => {
    const email = `${name}.${run.toLowerCase()}@ebms.test`;
    const u = await call<{ id: string }>('POST', '/users', admin, {
      email,
      fullName: `${name[0].toUpperCase()}${name.slice(1)} ${run}`,
      password: USER_PASSWORD,
      roleKey: role,
      branchIds: [branch.id],
    });
    return { email, id: u.id };
  };
  const users = {
    cashier: await mkUser('CASHIER', 'cashier'),
    manager: await mkUser('MANAGER', 'manager'),
    inventory: await mkUser('INVENTORY_OFFICER', 'inventory'),
    procurement: await mkUser('PROCUREMENT_OFFICER', 'procurement'),
    auditor: await mkUser('AUDITOR', 'auditor'),
  };

  const category = await call<{ id: string }>('POST', '/categories', admin, {
    name: `Electronics ${run}`,
  });
  const brand = await call<{ id: string }>('POST', '/brands', admin, {
    name: `Contoso ${run}`,
  });
  const mkProduct = async (
    sku: string,
    name: string,
    extra: Record<string, unknown>,
    costPrice: string,
    sellingPrice: string,
  ) => {
    const p = await call<{ id: string; sku: string }>('POST', '/products', admin, {
      sku: `${sku}-${run}`,
      name,
      categoryId: category.id,
      brandId: brand.id,
      costPrice,
      sellingPrice,
      reorderLevel: 2,
      ...extra,
    });
    return { id: p.id, sku: p.sku };
  };
  const products = {
    laptop: await mkProduct(
      'LAPTOP-PB450',
      `ProBook 450 G10 ${run}`,
      { trackingMode: 'SERIALIZED', identifierType: 'SERIAL', identifiersPerUnit: 1 },
      '1400000',
      '1750000',
    ),
    phone: await mkProduct(
      'PHONE-DS',
      `Galaxy Dual SIM ${run}`,
      { trackingMode: 'SERIALIZED', identifierType: 'IMEI', identifiersPerUnit: 2 },
      '700000',
      '900000',
    ),
    cable: await mkProduct(
      'CABLE-USBC',
      `USB-C Cable 1m ${run}`,
      { trackingMode: 'QUANTITY' },
      '8000',
      '15000',
    ),
  };
  const supplier = await call<{ id: string }>('POST', '/suppliers', admin, {
    name: `Mlimani Distributors ${run}`,
  });

  // VAT 18% (idempotent: same rate is a no-op).
  await call('PUT', '/settings/tax', admin, { ratePercent: '18' });

  // Purchase order: created + submitted by procurement, approved by the manager
  // (BR-14 then lets the inventory officer receive it in the browser).
  const proc = await loginToken(users.procurement.email, USER_PASSWORD);
  const manager = await loginToken(users.manager.email, USER_PASSWORD);
  const po = await call<{ id: string; reference: string }>('POST', '/purchases', proc, {
    branchId: branch.id,
    supplierId: supplier.id,
    items: [
      { productId: products.laptop.id, quantity: 2, unitCost: '1400000' },
      { productId: products.phone.id, quantity: 1, unitCost: '700000' },
      { productId: products.cable.id, quantity: 20, unitCost: '8000' },
    ],
  });
  await call('POST', `/purchases/${po.id}/submit`, proc);
  await call('POST', `/purchases/${po.id}/approve`, manager);

  return {
    run,
    branch,
    users,
    products,
    purchaseId: po.id,
    purchaseReference: po.reference,
  };
}

/** Valid 15-digit IMEI (Luhn) from a 14-digit body. */
export function imei(body14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(body14[13 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return body14 + String((10 - (sum % 10)) % 10);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildFixture().then(
    (f) => console.log(JSON.stringify(f, null, 2)),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    },
  );
}
