import type { RoleKey } from '../src/access/permissions';
import {
  assertDemoSeedAllowed,
  seedDemoCatalogue,
} from '../src/database/demo-catalogue';
import {
  bearer,
  createBranch,
  createTestApp,
  createUser,
  login,
  resetDatabase,
  TestContext,
} from './utils/test-app';

const ROLES: RoleKey[] = [
  'SYSTEM_ADMIN',
  'MANAGER',
  'INVENTORY_OFFICER',
  'PROCUREMENT_OFFICER',
  'CASHIER',
  'TECHNICIAN',
  'AUDITOR',
];
const CATALOGUE_WRITERS: RoleKey[] = ['SYSTEM_ADMIN', 'INVENTORY_OFFICER'];
const PRICE_CHANGERS: RoleKey[] = ['SYSTEM_ADMIN', 'MANAGER'];
const NO_COST: RoleKey[] = ['CASHIER', 'TECHNICIAN'];

describe('Product catalogue — Module 3 (e2e)', () => {
  let ctx: TestContext;
  const token: Partial<Record<RoleKey, string>> = {};
  const as = (role: RoleKey) => bearer(token[role]!);
  let laptops: string; // category
  let hp: string; // brand
  let laptopId: string; // product
  const ids: Partial<Record<RoleKey, string>> = {};

  const productBody = (overrides: Record<string, unknown> = {}) => ({
    sku: 'hp-pb450-g10-i5',
    name: '  HP  ProBook 450 G10 i5 ',
    categoryId: laptops,
    brandId: hp,
    trackingMode: 'SERIALIZED',
    identifierType: 'SERIAL',
    costPrice: '1450000',
    sellingPrice: '1750000.00',
    reorderLevel: 2,
    specifications: {
      cpu: 'Intel Core i5-1335U',
      ram: '16GB',
      screen_inches: 15.6,
    },
    ...overrides,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const branch = await createBranch(ctx.prisma, 'BR-A');
    for (const role of ROLES) {
      const email = `${role.toLowerCase()}@cat.test`;
      ids[role] = await createUser(ctx.prisma, {
        email,
        roleKey: role,
        branchIds: role === 'SYSTEM_ADMIN' ? [] : [branch],
      });
      token[role] = (await login(ctx, email)).accessToken;
    }
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  // ------------------------------------------------------------ categories
  describe('categories and brands', () => {
    it('creates a category with a cleaned name (inventory officer)', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/categories')
        .set(as('INVENTORY_OFFICER'))
        .send({
          name: '  Laptops   & Notebooks ',
          description: 'Portable computers',
        })
        .expect(201);
      expect(res.body.data).toMatchObject({
        name: 'Laptops & Notebooks',
        description: 'Portable computers',
        isActive: true,
      });
      expect(res.body.data).not.toHaveProperty('nameKey');
      laptops = res.body.data.id;
    });

    it('rejects duplicate names regardless of case or spacing (409)', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/categories')
        .set(as('SYSTEM_ADMIN'))
        .send({ name: 'LAPTOPS  &  notebooks' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'DUPLICATE_VALUE' });
      expect(res.body.details[0].field).toBe('name');
    });

    it('creates brands; duplicates (case-insensitive) are rejected', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/brands')
        .set(as('INVENTORY_OFFICER'))
        .send({ name: 'HP' })
        .expect(201);
      hp = res.body.data.id;
      await ctx
        .http()
        .post('/api/v1/brands')
        .set(as('SYSTEM_ADMIN'))
        .send({ name: 'hp' })
        .expect(409);
      // brands have no description field
      await ctx
        .http()
        .post('/api/v1/brands')
        .set(as('SYSTEM_ADMIN'))
        .send({ name: 'Dell', description: 'x' })
        .expect(400);
    });

    it.each(ROLES.filter((r) => !CATALOGUE_WRITERS.includes(r)))(
      '%s cannot create or update categories/brands (403)',
      async (role) => {
        await ctx
          .http()
          .post('/api/v1/categories')
          .set(as(role))
          .send({ name: `x-${role}` })
          .expect(403);
        await ctx
          .http()
          .post('/api/v1/brands')
          .set(as(role))
          .send({ name: `x-${role}` })
          .expect(403);
        await ctx
          .http()
          .patch(`/api/v1/categories/${laptops}`)
          .set(as(role))
          .send({ name: 'y' })
          .expect(403);
        await ctx
          .http()
          .patch(`/api/v1/brands/${hp}`)
          .set(as(role))
          .send({ name: 'y' })
          .expect(403);
      },
    );

    it.each(ROLES)(
      '%s can list and view categories and brands',
      async (role) => {
        const list = await ctx
          .http()
          .get('/api/v1/categories?q=lap')
          .set(as(role))
          .expect(200);
        expect(list.body.data.map((c: { id: string }) => c.id)).toContain(
          laptops,
        );
        await ctx.http().get(`/api/v1/brands/${hp}`).set(as(role)).expect(200);
      },
    );

    it('requires authentication and returns 404 for unknown ids', async () => {
      await ctx.http().get('/api/v1/categories').expect(401);
      await ctx
        .http()
        .get('/api/v1/categories/00000000-0000-4000-8000-000000000000')
        .set(as('CASHIER'))
        .expect(404);
    });
  });

  // -------------------------------------------------------------- products
  describe('creating products', () => {
    it('creates a serialized product with normalised SKU, money strings and tax-exclusive price', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/products')
        .set(as('INVENTORY_OFFICER'))
        .send(productBody())
        .expect(201);
      expect(res.body.data).toMatchObject({
        sku: 'HP-PB450-G10-I5',
        name: 'HP ProBook 450 G10 i5',
        trackingMode: 'SERIALIZED',
        identifierType: 'SERIAL',
        identifiersPerUnit: 1,
        costPrice: '1450000.00',
        sellingPrice: '1750000.00',
        currency: 'TZS',
        priceIncludesTax: false,
        category: { id: laptops },
        brand: { id: hp, name: 'HP' },
        specifications: {
          cpu: 'Intel Core i5-1335U',
          ram: '16GB',
          screen_inches: 15.6,
        },
      });
      laptopId = res.body.data.id;
    });

    it('creates a quantity product and a dual-IMEI phone', async () => {
      const q = await ctx
        .http()
        .post('/api/v1/products')
        .set(as('SYSTEM_ADMIN'))
        .send(
          productBody({
            sku: 'ANKER-USB-C-1M',
            name: 'Anker USB-C cable 1m',
            trackingMode: 'QUANTITY',
            identifierType: undefined,
            costPrice: '8000',
            sellingPrice: '15000',
          }),
        )
        .expect(201);
      expect(q.body.data).toMatchObject({
        identifierType: null,
        identifiersPerUnit: null,
      });

      const phone = await ctx
        .http()
        .post('/api/v1/products')
        .set(as('SYSTEM_ADMIN'))
        .send(
          productBody({
            sku: 'SAM-A15-128-BLK',
            name: 'Galaxy A15',
            identifierType: 'IMEI',
            identifiersPerUnit: 2,
          }),
        )
        .expect(201);
      expect(phone.body.data.identifiersPerUnit).toBe(2);
    });

    it('rejects duplicate SKUs regardless of case (T-04)', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/products')
        .set(as('SYSTEM_ADMIN'))
        .send(productBody({ sku: 'Hp-Pb450-G10-I5' }))
        .expect(409);
      expect(res.body).toMatchObject({
        code: 'DUPLICATE_VALUE',
        details: [{ field: 'sku' }],
      });
    });

    it('lets exactly one of two concurrent identical creates succeed (DB constraint)', async () => {
      const send = () =>
        ctx
          .http()
          .post('/api/v1/products')
          .set(as('SYSTEM_ADMIN'))
          .send(productBody({ sku: 'RACE-SKU-1' }));
      const results = await Promise.all([send(), send(), send()]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409]);
      expect(
        await ctx.prisma.product.count({ where: { sku: 'RACE-SKU-1' } }),
      ).toBe(1);
    });

    it.each([
      [
        { trackingMode: 'SERIALIZED', identifierType: undefined },
        'identifierType',
      ],
      [
        { trackingMode: 'QUANTITY', identifierType: 'SERIAL' },
        'identifierType',
      ],
      [{ identifiersPerUnit: 3 }, 'identifiersPerUnit'],
      [{ sku: 'BAD SKU' }, 'sku'],
      [{ sku: '-X' }, 'sku'],
      [{ costPrice: 1450000 }, 'costPrice'],
      [{ sellingPrice: '-1' }, 'sellingPrice'],
      [{ sellingPrice: '10.005' }, 'sellingPrice'],
      [{ specifications: { nested: { a: 1 } } }, 'specifications'],
      [{ specifications: ['a'] }, 'specifications'],
      [{ name: '   ' }, 'name'],
      [{ reorderLevel: -1 }, 'reorderLevel'],
      [{ totalValue: '1' }, 'totalValue'],
    ])('rejects invalid input %p (400)', async (override, field) => {
      const res = await ctx
        .http()
        .post('/api/v1/products')
        .set(as('SYSTEM_ADMIN'))
        .send(productBody({ sku: `VAL-${field}`.toUpperCase(), ...override }))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details.map((d: { field: string }) => d.field)).toContain(
        field,
      );
    });

    it('rejects unknown (404) and inactive (400 REFERENCE_INACTIVE) category/brand', async () => {
      await ctx
        .http()
        .post('/api/v1/products')
        .set(as('SYSTEM_ADMIN'))
        .send(
          productBody({
            sku: 'REF-1',
            brandId: '00000000-0000-4000-8000-000000000000',
          }),
        )
        .expect(404);
      const old = await ctx
        .http()
        .post('/api/v1/brands')
        .set(as('SYSTEM_ADMIN'))
        .send({ name: 'OldBrand' });
      await ctx
        .http()
        .patch(`/api/v1/brands/${old.body.data.id}`)
        .set(as('SYSTEM_ADMIN'))
        .send({ isActive: false })
        .expect(200);
      const res = await ctx
        .http()
        .post('/api/v1/products')
        .set(as('SYSTEM_ADMIN'))
        .send(productBody({ sku: 'REF-2', brandId: old.body.data.id }))
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'REFERENCE_INACTIVE',
        details: [{ field: 'brandId' }],
      });
    });

    it.each(ROLES.filter((r) => !CATALOGUE_WRITERS.includes(r)))(
      '%s cannot create products (403), even a manager',
      async (role) => {
        const res = await ctx
          .http()
          .post('/api/v1/products')
          .set(as(role))
          .send(productBody({ sku: `NOPE-${role}`.slice(0, 40) }))
          .expect(403);
        expect(res.body.code).toBe('PERMISSION_DENIED');
      },
    );
  });

  // -------------------------------------------------------- reading & cost
  describe('reading products and cost visibility (D4)', () => {
    it.each(ROLES)(
      '%s can read products; costPrice only if permitted',
      async (role) => {
        const one = await ctx
          .http()
          .get(`/api/v1/products/${laptopId}`)
          .set(as(role))
          .expect(200);
        const list = await ctx
          .http()
          .get('/api/v1/products?limit=100')
          .set(as(role))
          .expect(200);
        const hidden = NO_COST.includes(role);
        expect('costPrice' in one.body.data).toBe(!hidden);
        for (const p of list.body.data) expect('costPrice' in p).toBe(!hidden);
        if (hidden) {
          expect(JSON.stringify(one.body)).not.toContain('1450000');
          expect(JSON.stringify(list.body)).not.toContain('1450000');
        }
      },
    );

    it('searches by SKU fragment or name, exact SKU, filters, sorts and paginates', async () => {
      const bySku = await ctx
        .http()
        .get('/api/v1/products?q=pb450')
        .set(as('CASHIER'))
        .expect(200);
      expect(bySku.body.data.map((p: { id: string }) => p.id)).toContain(
        laptopId,
      );
      const byName = await ctx
        .http()
        .get('/api/v1/products?q=probook')
        .set(as('CASHIER'))
        .expect(200);
      // Several fixtures share this name; order among equal names is by id, so assert membership.
      expect(byName.body.data.map((p: { id: string }) => p.id)).toContain(
        laptopId,
      );
      for (const p of byName.body.data)
        expect(p.name.toLowerCase()).toContain('probook');
      const exact = await ctx
        .http()
        .get('/api/v1/products?sku=hp-pb450-g10-i5')
        .set(as('CASHIER'))
        .expect(200);
      expect(exact.body.meta.pagination.total).toBe(1);
      const qty = await ctx
        .http()
        .get('/api/v1/products?trackingMode=QUANTITY')
        .set(as('CASHIER'))
        .expect(200);
      for (const p of qty.body.data) expect(p.trackingMode).toBe('QUANTITY');
      const sorted = await ctx
        .http()
        .get('/api/v1/products?sort=sellingPrice&order=desc&limit=2')
        .set(as('CASHIER'))
        .expect(200);
      expect(sorted.body.data).toHaveLength(2);
      expect(Number(sorted.body.data[0].sellingPrice)).toBeGreaterThanOrEqual(
        Number(sorted.body.data[1].sellingPrice),
      );
      // cost price is not a sort key (could be inferred by cashiers)
      await ctx
        .http()
        .get('/api/v1/products?sort=costPrice')
        .set(as('CASHIER'))
        .expect(400);
    });
  });

  // ------------------------------------------------- field-level PATCH (D5)
  describe('updating products — field-level permissions (D5)', () => {
    const patch = (role: RoleKey, body: Record<string, unknown>) =>
      ctx.http().patch(`/api/v1/products/${laptopId}`).set(as(role)).send(body);
    const current = () =>
      ctx.prisma.product.findUniqueOrThrow({ where: { id: laptopId } });

    it('INVENTORY_OFFICER updates ordinary fields', async () => {
      const res = await patch('INVENTORY_OFFICER', {
        name: 'HP ProBook 450 G10',
        reorderLevel: 3,
      }).expect(200);
      expect(res.body.data).toMatchObject({
        name: 'HP ProBook 450 G10',
        reorderLevel: 3,
      });
    });

    it('INVENTORY_OFFICER cannot change prices after creation, alone or mixed (nothing changes)', async () => {
      const before = await current();
      await patch('INVENTORY_OFFICER', { sellingPrice: '1' }).expect(403);
      await patch('INVENTORY_OFFICER', {
        name: 'Sneaky rename',
        costPrice: '1',
      }).expect(403);
      const after = await current();
      expect(after.name).toBe(before.name);
      expect(after.sellingPrice.toString()).toBe(
        before.sellingPrice.toString(),
      );
      expect(after.costPrice.toString()).toBe(before.costPrice.toString());
    });

    it('MANAGER changes prices but not ordinary fields, alone or mixed (nothing changes)', async () => {
      const res = await patch('MANAGER', { sellingPrice: '1690000' }).expect(
        200,
      );
      expect(res.body.data.sellingPrice).toBe('1690000.00');
      const before = await current();
      await patch('MANAGER', { name: 'Manager rename' }).expect(403);
      await patch('MANAGER', {
        name: 'Manager rename',
        sellingPrice: '1',
      }).expect(403);
      const after = await current();
      expect(after.name).toBe(before.name);
      expect(after.sellingPrice.toString()).toBe('1690000');
    });

    it.each([
      'PROCUREMENT_OFFICER',
      'CASHIER',
      'TECHNICIAN',
      'AUDITOR',
    ] as RoleKey[])('%s cannot patch prices or fields (403)', async (role) => {
      await patch(role, { sellingPrice: '1' }).expect(403);
      await patch(role, { name: 'x' }).expect(403);
    });

    it('SYSTEM_ADMIN can change both in one request; both changes are audited with old → new', async () => {
      await patch('SYSTEM_ADMIN', {
        name: 'HP ProBook 450 G10 i5',
        costPrice: '1400000',
        sellingPrice: '1700000.50',
      }).expect(200);
      const events = await ctx.prisma.auditLog.findMany({
        where: { entityId: laptopId, actorId: ids.SYSTEM_ADMIN },
        orderBy: { createdAt: 'asc' },
      });
      const price = events.find((e) => e.action === 'product.price_changed')!;
      expect(price.metadata).toMatchObject({
        sku: 'HP-PB450-G10-I5',
        changedFields: ['costPrice', 'sellingPrice'],
        changes: {
          costPrice: { from: '1450000.00', to: '1400000.00' },
          sellingPrice: { from: '1690000.00', to: '1700000.50' },
        },
      });
      expect(price.createdAt).toBeInstanceOf(Date);
      const upd = events.find((e) => e.action === 'product.updated')!;
      expect(upd.metadata).toMatchObject({
        changes: {
          name: { from: 'HP ProBook 450 G10', to: 'HP ProBook 450 G10 i5' },
        },
      });
    });

    it('the manager price change was audited with the manager as actor', async () => {
      const e = await ctx.prisma.auditLog.findFirstOrThrow({
        where: {
          entityId: laptopId,
          action: 'product.price_changed',
          actorId: ids.MANAGER,
        },
      });
      expect(e.metadata).toMatchObject({
        changedFields: ['sellingPrice'],
        changes: { sellingPrice: { from: '1750000.00', to: '1690000.00' } },
      });
    });

    it('selling below cost is allowed but audited (D6)', async () => {
      await patch('MANAGER', { sellingPrice: '1000000' }).expect(200);
      const e = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: laptopId, action: 'product.selling_below_cost' },
      });
      expect(e.metadata).toMatchObject({
        costPrice: '1400000.00',
        sellingPrice: '1000000.00',
      });
      await patch('MANAGER', { sellingPrice: '1700000' }).expect(200);
    });

    it('exactly the price-changer roles can change a price (D5)', async () => {
      for (const role of ROLES) {
        const res = await patch(role, { sellingPrice: '1700000' });
        expect(res.status).toBe(PRICE_CHANGERS.includes(role) ? 200 : 403);
      }
    });

    it('SKU and tracking policy are immutable (D9); repeating the same value is fine', async () => {
      const res = await patch('SYSTEM_ADMIN', { sku: 'NEW-SKU' }).expect(400);
      expect(res.body).toMatchObject({
        code: 'IMMUTABLE_FIELD',
        details: [{ field: 'sku' }],
      });
      await patch('SYSTEM_ADMIN', { trackingMode: 'QUANTITY' }).expect(400);
      await patch('SYSTEM_ADMIN', { identifiersPerUnit: 2 }).expect(400);
      await patch('SYSTEM_ADMIN', {
        sku: 'hp-pb450-g10-i5',
        reorderLevel: 4,
      }).expect(200);
    });
  });

  // -------------------------------------------------- deactivation (D12)
  describe('deactivation rules (D12)', () => {
    it('blocks deactivating a category or brand used by active products (409)', async () => {
      const c = await ctx
        .http()
        .patch(`/api/v1/categories/${laptops}`)
        .set(as('SYSTEM_ADMIN'))
        .send({ isActive: false })
        .expect(409);
      expect(c.body.code).toBe('CATEGORY_IN_USE');
      const b = await ctx
        .http()
        .patch(`/api/v1/brands/${hp}`)
        .set(as('SYSTEM_ADMIN'))
        .send({ isActive: false })
        .expect(409);
      expect(b.body.code).toBe('BRAND_IN_USE');
    });

    it('allows it once its products are inactive; such products cannot be reactivated', async () => {
      const cat = await ctx
        .http()
        .post('/api/v1/categories')
        .set(as('SYSTEM_ADMIN'))
        .send({ name: 'Projectors' });
      const prod = await ctx
        .http()
        .post('/api/v1/products')
        .set(as('SYSTEM_ADMIN'))
        .send(
          productBody({
            sku: 'EPSON-X1',
            name: 'Epson projector',
            categoryId: cat.body.data.id,
          }),
        )
        .expect(201);
      await ctx
        .http()
        .patch(`/api/v1/products/${prod.body.data.id}`)
        .set(as('INVENTORY_OFFICER'))
        .send({ isActive: false })
        .expect(200);
      await ctx
        .http()
        .patch(`/api/v1/categories/${cat.body.data.id}`)
        .set(as('SYSTEM_ADMIN'))
        .send({ isActive: false })
        .expect(200);
      const re = await ctx
        .http()
        .patch(`/api/v1/products/${prod.body.data.id}`)
        .set(as('INVENTORY_OFFICER'))
        .send({ isActive: true })
        .expect(400);
      expect(re.body.code).toBe('REFERENCE_INACTIVE');
      const actions = (
        await ctx.prisma.auditLog.findMany({
          where: { entityId: { in: [cat.body.data.id, prod.body.data.id] } },
          select: { action: true },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['product.deactivated', 'category.deactivated']),
      );
    });

    it('never leaves an active product in an inactive category under concurrency', async () => {
      for (let round = 0; round < 5; round++) {
        const cat = await ctx
          .http()
          .post('/api/v1/categories')
          .set(as('SYSTEM_ADMIN'))
          .send({ name: `Race ${round}` });
        const catId = cat.body.data.id;
        await Promise.all([
          ctx
            .http()
            .patch(`/api/v1/categories/${catId}`)
            .set(as('SYSTEM_ADMIN'))
            .send({ isActive: false }),
          ctx
            .http()
            .post('/api/v1/products')
            .set(as('SYSTEM_ADMIN'))
            .send(productBody({ sku: `RACE-CAT-${round}`, categoryId: catId })),
        ]);
        const category = await ctx.prisma.category.findUniqueOrThrow({
          where: { id: catId },
        });
        const active = await ctx.prisma.product.count({
          where: { categoryId: catId, isActive: true },
        });
        // Invariant (D12): an inactive category never has active products.
        if (!category.isActive) expect(active).toBe(0);
      }
    });
  });

  // ------------------------------------------------- database guarantees
  describe('database constraints (integration)', () => {
    it('reject invalid rows even when written directly', async () => {
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE products SET sku = 'CHANGED' WHERE id = '${laptopId}'`,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE products SET tracking_mode = 'QUANTITY', identifier_type = NULL, identifiers_per_unit = NULL WHERE id = '${laptopId}'`,
        ),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE products SET selling_price = -1 WHERE id = '${laptopId}'`,
        ),
      ).rejects.toThrow(/products_prices_chk/);
      await expect(
        ctx.prisma.product.create({
          data: {
            sku: 'lowercase',
            name: 'x',
            categoryId: laptops,
            brandId: hp,
            trackingMode: 'QUANTITY',
            costPrice: '1',
            sellingPrice: '1',
          },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.product.create({
          data: {
            sku: 'NO-POLICY',
            name: 'x',
            categoryId: laptops,
            brandId: hp,
            trackingMode: 'SERIALIZED',
            costPrice: '1',
            sellingPrice: '1',
          },
        }),
      ).rejects.toThrow();
    });
  });

  // --------------------------------------------- audit visibility (D13)
  describe('catalogue audit visibility (D13)', () => {
    it.each(['MANAGER', 'AUDITOR', 'SYSTEM_ADMIN'] as RoleKey[])(
      '%s sees catalogue events',
      async (role) => {
        const res = await ctx
          .http()
          .get('/api/v1/audit-logs?entityType=Product&limit=100')
          .set(as(role))
          .expect(200);
        const actions = res.body.data.map((e: { action: string }) => e.action);
        expect(actions).toEqual(
          expect.arrayContaining(['product.created', 'product.price_changed']),
        );
      },
    );

    it('managers and auditors still do not see global login events', async () => {
      for (const role of ['MANAGER', 'AUDITOR'] as RoleKey[]) {
        const res = await ctx
          .http()
          .get('/api/v1/audit-logs?limit=100')
          .set(as(role))
          .expect(200);
        const actions: string[] = res.body.data.map(
          (e: { action: string }) => e.action,
        );
        expect(actions.some((a) => a.startsWith('auth.'))).toBe(false);
        for (const e of res.body.data) {
          expect(
            ['Category', 'Brand', 'Product'].includes(e.entityType) ||
              e.branchId !== null,
          ).toBe(true);
        }
      }
      const admin = await ctx
        .http()
        .get('/api/v1/audit-logs?action=auth.login.succeeded')
        .set(as('SYSTEM_ADMIN'))
        .expect(200);
      expect(admin.body.data.length).toBeGreaterThan(0);
    });

    it.each([
      'CASHIER',
      'TECHNICIAN',
      'INVENTORY_OFFICER',
      'PROCUREMENT_OFFICER',
    ] as RoleKey[])('%s cannot read the audit log', async (role) => {
      await ctx.http().get('/api/v1/audit-logs').set(as(role)).expect(403);
    });
  });
});

describe('db:seed:demo (D15)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('refuses outside NODE_ENV=development (production, test, unset, typo)', () => {
    for (const env of ['production', 'test', undefined, 'Development', 'dev']) {
      expect(() => assertDemoSeedAllowed(env)).toThrow(/refused/);
    }
    expect(() => assertDemoSeedAllowed('development')).not.toThrow();
  });

  it('creates a valid demo catalogue and is idempotent', async () => {
    const first = await seedDemoCatalogue(ctx.prisma);
    expect(first).toEqual({
      categoriesCreated: 5,
      brandsCreated: 7,
      productsCreated: 9,
    });
    const second = await seedDemoCatalogue(ctx.prisma);
    expect(second).toEqual({
      categoriesCreated: 0,
      brandsCreated: 0,
      productsCreated: 0,
    });
    expect(await ctx.prisma.product.count()).toBe(9);
    const dualSim = await ctx.prisma.product.findUniqueOrThrow({
      where: { sku: 'DEMO-SAM-A15-128-BLK' },
    });
    expect(dualSim).toMatchObject({
      trackingMode: 'SERIALIZED',
      identifierType: 'IMEI',
      identifiersPerUnit: 2,
    });
  });
});
