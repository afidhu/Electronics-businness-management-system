import type { PrismaClient } from '../generated/prisma/client';
import { nameKey, normaliseSku } from '../catalogue/catalogue-rules';

/**
 * Demo catalogue for local development (D15). Prices are illustrative TZS,
 * tax-exclusive. NEVER for production: guarded by assertDemoSeedAllowed().
 */
const CATEGORIES = [
  'Smartphones',
  'Laptops',
  'Televisions',
  'Audio',
  'Accessories',
];
const BRANDS = ['Samsung', 'Apple', 'Tecno', 'HP', 'Lenovo', 'Sony', 'Anker'];

interface DemoProduct {
  sku: string;
  name: string;
  category: string;
  brand: string;
  trackingMode: 'SERIALIZED' | 'QUANTITY';
  identifierType?: 'IMEI' | 'SERIAL';
  identifiersPerUnit?: number;
  costPrice: string;
  sellingPrice: string;
  reorderLevel: number;
  specifications: Record<string, string | number | boolean>;
}

const PRODUCTS: DemoProduct[] = [
  {
    sku: 'DEMO-SAM-A15-128-BLK',
    name: 'Samsung Galaxy A15 128GB Black',
    category: 'Smartphones',
    brand: 'Samsung',
    trackingMode: 'SERIALIZED',
    identifierType: 'IMEI',
    identifiersPerUnit: 2,
    costPrice: '380000',
    sellingPrice: '450000',
    reorderLevel: 5,
    specifications: {
      storage: '128GB',
      ram: '4GB',
      colour: 'Black',
      dual_sim: true,
    },
  },
  {
    sku: 'DEMO-APL-IP15-128-BLU',
    name: 'Apple iPhone 15 128GB Blue',
    category: 'Smartphones',
    brand: 'Apple',
    trackingMode: 'SERIALIZED',
    identifierType: 'IMEI',
    identifiersPerUnit: 1,
    costPrice: '2100000',
    sellingPrice: '2450000',
    reorderLevel: 2,
    specifications: { storage: '128GB', colour: 'Blue' },
  },
  {
    sku: 'DEMO-TEC-SPARK20-128',
    name: 'Tecno Spark 20 128GB',
    category: 'Smartphones',
    brand: 'Tecno',
    trackingMode: 'SERIALIZED',
    identifierType: 'IMEI',
    identifiersPerUnit: 2,
    costPrice: '250000',
    sellingPrice: '300000',
    reorderLevel: 8,
    specifications: { storage: '128GB', ram: '8GB', dual_sim: true },
  },
  {
    sku: 'DEMO-HP-PB450-G10-I5',
    name: 'HP ProBook 450 G10 i5 16GB/512GB',
    category: 'Laptops',
    brand: 'HP',
    trackingMode: 'SERIALIZED',
    identifierType: 'SERIAL',
    identifiersPerUnit: 1,
    costPrice: '1450000',
    sellingPrice: '1750000',
    reorderLevel: 2,
    specifications: {
      cpu: 'Intel Core i5-1335U',
      ram: '16GB',
      storage: '512GB SSD',
      screen_inches: 15.6,
    },
  },
  {
    sku: 'DEMO-LEN-IP3-R5',
    name: 'Lenovo IdeaPad 3 Ryzen 5 8GB/256GB',
    category: 'Laptops',
    brand: 'Lenovo',
    trackingMode: 'SERIALIZED',
    identifierType: 'SERIAL',
    identifiersPerUnit: 1,
    costPrice: '980000',
    sellingPrice: '1150000',
    reorderLevel: 2,
    specifications: { cpu: 'AMD Ryzen 5', ram: '8GB', storage: '256GB SSD' },
  },
  {
    sku: 'DEMO-SAM-TV-55-CU7000',
    name: 'Samsung 55" Crystal UHD TV',
    category: 'Televisions',
    brand: 'Samsung',
    trackingMode: 'SERIALIZED',
    identifierType: 'SERIAL',
    identifiersPerUnit: 1,
    costPrice: '1300000',
    sellingPrice: '1550000',
    reorderLevel: 1,
    specifications: { screen_inches: 55, resolution: '4K UHD', smart_tv: true },
  },
  {
    sku: 'DEMO-SNY-WH1000XM5',
    name: 'Sony WH-1000XM5 Headphones',
    category: 'Audio',
    brand: 'Sony',
    trackingMode: 'SERIALIZED',
    identifierType: 'SERIAL',
    identifiersPerUnit: 1,
    costPrice: '720000',
    sellingPrice: '890000',
    reorderLevel: 2,
    specifications: { noise_cancelling: true, wireless: true },
  },
  {
    sku: 'DEMO-ANK-USBC-1M',
    name: 'Anker USB-C to USB-C Cable 1m',
    category: 'Accessories',
    brand: 'Anker',
    trackingMode: 'QUANTITY',
    costPrice: '8000',
    sellingPrice: '15000',
    reorderLevel: 30,
    specifications: { length_m: 1, connector: 'USB-C' },
  },
  {
    sku: 'DEMO-ANK-20W-CHG',
    name: 'Anker 20W USB-C Charger',
    category: 'Accessories',
    brand: 'Anker',
    trackingMode: 'QUANTITY',
    costPrice: '22000',
    sellingPrice: '35000',
    reorderLevel: 20,
    specifications: { watts: 20 },
  },
];

/**
 * Throws unless NODE_ENV is EXACTLY "development". An unset or mistyped
 * value also refuses, so demo data can never reach production or tests.
 */
export function assertDemoSeedAllowed(nodeEnv: string | undefined): void {
  if (nodeEnv !== 'development') {
    throw new Error(
      `db:seed:demo refused: NODE_ENV is "${nodeEnv ?? '(unset)'}"; demo data is only allowed when NODE_ENV=development`,
    );
  }
}

export interface DemoSeedResult {
  categoriesCreated: number;
  brandsCreated: number;
  productsCreated: number;
}

/** Idempotent: creates missing records only; never overwrites existing ones. */
export async function seedDemoCatalogue(
  prisma: PrismaClient,
): Promise<DemoSeedResult> {
  return prisma.$transaction(async (tx) => {
    const result: DemoSeedResult = {
      categoriesCreated: 0,
      brandsCreated: 0,
      productsCreated: 0,
    };
    const categoryIds = new Map<string, string>();
    const brandIds = new Map<string, string>();

    for (const name of CATEGORIES) {
      const existing = await tx.category.findUnique({
        where: { nameKey: nameKey(name) },
      });
      const row =
        existing ??
        (await tx.category.create({ data: { name, nameKey: nameKey(name) } }));
      if (!existing) result.categoriesCreated++;
      categoryIds.set(name, row.id);
    }
    for (const name of BRANDS) {
      const existing = await tx.brand.findUnique({
        where: { nameKey: nameKey(name) },
      });
      const row =
        existing ??
        (await tx.brand.create({ data: { name, nameKey: nameKey(name) } }));
      if (!existing) result.brandsCreated++;
      brandIds.set(name, row.id);
    }
    for (const p of PRODUCTS) {
      const sku = normaliseSku(p.sku);
      if (await tx.product.findUnique({ where: { sku } })) continue;
      const created = await tx.product.create({
        data: {
          sku,
          name: p.name,
          categoryId: categoryIds.get(p.category)!,
          brandId: brandIds.get(p.brand)!,
          trackingMode: p.trackingMode,
          identifierType: p.identifierType ?? null,
          identifiersPerUnit: p.identifierType
            ? (p.identifiersPerUnit ?? 1)
            : null,
          costPrice: p.costPrice,
          sellingPrice: p.sellingPrice,
          reorderLevel: p.reorderLevel,
          specifications: p.specifications,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'product.created',
          entityType: 'Product',
          entityId: created.id,
          metadata: { sku, source: 'demo-seed' },
        },
      });
      result.productsCreated++;
    }
    return result;
  });
}
