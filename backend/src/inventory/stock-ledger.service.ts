import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { weightedAverageCost } from './inventory-rules';

type Tx = Prisma.TransactionClient;

export interface StockIncrease {
  productId: string;
  branchId: string;
  quantity: number;
  unitCost: Prisma.Decimal;
  movementType:
    | 'PURCHASE_RECEIPT'
    | 'OPENING_BALANCE'
    | 'ADJUSTMENT_INCREASE'
    | 'TRANSFER_IN';
  /** Serialized products: one id per unit (one ±1 movement each). */
  productUnitIds?: string[];
  referenceType: 'GOODS_RECEIPT' | 'ADJUSTMENT' | 'TRANSFER';
  referenceId: string;
  actorId: string;
}

export interface StockDecrease {
  productId: string;
  branchId: string;
  quantity: number;
  /** Cost per unit for the ledger row (Decimal(14,2)); the WAC for sales (S11). */
  unitCost: Prisma.Decimal;
  movementType: 'SALE';
  /** Serialized products: one id per unit (one -1 movement each). */
  productUnitIds?: string[];
  referenceType: 'SALE';
  referenceId: string;
  actorId: string;
}

/**
 * The single place where stock changes (ADR-030). Callers must:
 *  1. run inside a transaction,
 *  2. call lockValuations() for ALL affected products first (sorted), then
 *  3. apply changes in productId order — a deterministic lock order that
 *     prevents deadlocks between concurrent stock operations.
 */
@Injectable()
export class StockLedgerService {
  /**
   * Lock (creating if needed) the valuation row of each product, in sorted
   * order. Every stock change for a product holds this lock, so WAC and
   * organisation on-hand are read consistently (ADR-029).
   */
  async lockValuations(tx: Tx, productIds: readonly string[]): Promise<void> {
    const ids = [...new Set(productIds)].sort();
    if (ids.length === 0) return;
    await tx.$executeRaw`
      INSERT INTO "inventory_valuations" ("product_id", "average_cost", "updated_at")
      SELECT unnest(${ids}::uuid[]), 0, now()
      ON CONFLICT ("product_id") DO NOTHING`;
    await tx.$queryRaw`
      SELECT "product_id" FROM "inventory_valuations"
      WHERE "product_id" = ANY(${ids}::uuid[])
      ORDER BY "product_id" FOR UPDATE`;
  }

  /**
   * Outflow at the current average cost: WAC is unchanged (moving average),
   * the balance is decremented only if enough is available (a conditional
   * UPDATE, so concurrent sales cannot oversell), then ledger rows are added.
   * Returns false, changing nothing, when stock is insufficient.
   */
  async decrease(tx: Tx, change: StockDecrease): Promise<boolean> {
    const units = change.productUnitIds ?? [];
    if (!Number.isInteger(change.quantity) || change.quantity < 1) {
      throw new Error('quantity must be a positive integer');
    }
    if (units.length > 0 && units.length !== change.quantity) {
      throw new Error(
        'one productUnitId per unit is required for serialized stock',
      );
    }
    const updated = await tx.$executeRaw`
      UPDATE "stock_balances"
      SET "on_hand" = "on_hand" - ${change.quantity}, "updated_at" = now()
      WHERE "product_id" = ${change.productId}::uuid
        AND "branch_id" = ${change.branchId}::uuid
        AND "on_hand" - "reserved" >= ${change.quantity}`;
    if (updated !== 1) return false;

    const base = {
      productId: change.productId,
      branchId: change.branchId,
      movementType: change.movementType,
      unitCost: change.unitCost,
      referenceType: change.referenceType,
      referenceId: change.referenceId,
      actorId: change.actorId,
    };
    await tx.stockMovement.createMany({
      data:
        units.length > 0
          ? units.map((productUnitId) => ({
              ...base,
              id: randomUUID(),
              productUnitId,
              quantityDelta: -1,
              valueDelta: change.unitCost.negated(),
            }))
          : [
              {
                ...base,
                id: randomUUID(),
                quantityDelta: -change.quantity,
                valueDelta: change.unitCost.times(-change.quantity),
              },
            ],
    });
    return true;
  }

  /** Costed increase: WAC update, balance upsert, ledger rows. */
  async increase(tx: Tx, change: StockIncrease): Promise<void> {
    const units = change.productUnitIds ?? [];
    if (units.length > 0 && units.length !== change.quantity) {
      throw new Error(
        'one productUnitId per unit is required for serialized stock',
      );
    }

    // WAC (organisation-wide; valuation row already locked by the caller).
    const [{ on_hand }] = await tx.$queryRaw<{ on_hand: number }[]>`
      SELECT COALESCE(SUM("on_hand"), 0)::int AS on_hand
      FROM "stock_balances" WHERE "product_id" = ${change.productId}::uuid`;
    const current = await tx.inventoryValuation.findUniqueOrThrow({
      where: { productId: change.productId },
    });
    const average = weightedAverageCost(
      on_hand,
      on_hand > 0 ? current.averageCost : null,
      change.quantity,
      change.unitCost,
    );
    await tx.inventoryValuation.update({
      where: { productId: change.productId },
      data: { averageCost: average },
    });

    // Balance projection (BR-04): atomic upsert.
    await tx.$executeRaw`
      INSERT INTO "stock_balances" ("product_id", "branch_id", "on_hand", "reserved", "updated_at")
      VALUES (${change.productId}::uuid, ${change.branchId}::uuid, ${change.quantity}, 0, now())
      ON CONFLICT ("product_id", "branch_id")
      DO UPDATE SET "on_hand" = "stock_balances"."on_hand" + EXCLUDED."on_hand", "updated_at" = now()`;

    // Ledger: one row per serialized unit, else one row for the quantity.
    const base = {
      productId: change.productId,
      branchId: change.branchId,
      movementType: change.movementType,
      unitCost: change.unitCost,
      referenceType: change.referenceType,
      referenceId: change.referenceId,
      actorId: change.actorId,
    };
    await tx.stockMovement.createMany({
      data:
        units.length > 0
          ? units.map((productUnitId) => ({
              ...base,
              id: randomUUID(),
              productUnitId,
              quantityDelta: 1,
              valueDelta: change.unitCost,
            }))
          : [
              {
                ...base,
                id: randomUUID(),
                quantityDelta: change.quantity,
                valueDelta: change.unitCost.times(change.quantity),
              },
            ],
    });
  }
}
