import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BranchAccessService } from '../access/branch-access.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { IdentifierKind } from '../catalogue/catalogue-rules';
import {
  AppException,
  type FieldErrorDetail,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { RequestContext } from '../common/request-context/request-context';
import { businessDate } from '../common/time/business-time';
import { AppConfigService } from '../config/app-config.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentSequenceService } from '../procurement/document-sequence.service';
import { ReceiveGoodsDto } from './dto/receive.dto';
import { InventoryQueryService } from './inventory-query.service';
import {
  formatGrnReference,
  isBlockedReceiver,
  MAX_UNITS_PER_RECEIPT,
  prepareSerialUnits,
  repeatedValues,
  requestHash,
} from './inventory-rules';
import { StockLedgerService } from './stock-ledger.service';

type Tx = Prisma.TransactionClient;

interface LockedPo {
  id: string;
  reference: string;
  status: string;
  branchId: string;
  createdById: string;
  submittedById: string | null;
  approvedById: string | null;
}

interface PreparedLine {
  purchaseItemId: string;
  productId: string;
  quantity: number;
  unitCost: Prisma.Decimal;
  kind: IdentifierKind | null;
  units: string[][]; // normalised identifiers per unit (serialized only)
  sku: string;
}

export interface ReceiveResult {
  replayed: boolean;
  receiptId: string;
}

/**
 * Goods receiving (FR-INV-08..11, BR-14, ADR-030). One transaction:
 * receipt + items + units/identifiers + purchase line quantities + ledger +
 * balances + WAC + PO status + audit. Retry-safe via a mandatory idempotency key.
 */
@Injectable()
export class ReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly sequences: DocumentSequenceService,
    private readonly ledger: StockLedgerService,
    private readonly config: AppConfigService,
    private readonly queries: InventoryQueryService,
  ) {}

  async receive(
    purchaseId: string,
    dto: ReceiveGoodsDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    const { idempotencyKey, ...body } = dto;
    const hash = requestHash(`receive:${purchaseId}`, body);

    const replay = await this.findReplay(
      idempotencyKey,
      hash,
      purchaseId,
      actor.id,
    );
    if (replay)
      return {
        replayed: true,
        receipt: await this.queries.getReceipt(replay, actor),
      };

    const totalUnits = dto.items.reduce((n, i) => n + i.quantity, 0);
    if (totalUnits > MAX_UNITS_PER_RECEIPT) {
      throw validation([
        {
          field: 'items',
          messages: [`at most ${MAX_UNITS_PER_RECEIPT} units per receipt`],
        },
      ]);
    }

    let outcome:
      { blocked: true; po: LockedPo } | { blocked: false; receiptId: string };
    try {
      outcome = await this.prisma.$transaction(
        (tx) => this.receiveInTx(tx, purchaseId, dto, hash, actor, context),
        { timeout: 20_000 },
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        // Lost a race: either the same idempotency key, or a duplicate identifier.
        const winner = await this.findReplay(
          idempotencyKey,
          hash,
          purchaseId,
          actor.id,
        );
        if (winner)
          return {
            replayed: true,
            receipt: await this.queries.getReceipt(winner, actor),
          };
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.DUPLICATE_IDENTIFIER,
          'One or more identifiers were registered concurrently by another receipt',
        );
      }
      throw e;
    }

    if (outcome.blocked) {
      await this.audit.record({
        action: 'goods_receipt.blocked',
        entityType: 'Purchase',
        entityId: outcome.po.id,
        branchId: outcome.po.branchId,
        actorId: actor.id,
        metadata: {
          reference: outcome.po.reference,
          reason:
            'BR-14: actor created, submitted or approved this purchase order',
        },
        context,
      });
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.SELF_RECEIVING_FORBIDDEN,
        'You cannot receive a purchase order you created, submitted or approved',
      );
    }
    return {
      replayed: false,
      receipt: await this.queries.getReceipt(outcome.receiptId, actor),
    };
  }

  private async receiveInTx(
    tx: Tx,
    purchaseId: string,
    dto: ReceiveGoodsDto,
    hash: string,
    actor: AuthenticatedUser,
    context: RequestContext,
  ): Promise<
    { blocked: true; po: LockedPo } | { blocked: false; receiptId: string }
  > {
    // 1. Lock the PO (first in the lock order) and check scope, status, BR-14.
    const po = await this.lockPo(tx, purchaseId);
    this.branchAccess.assertCanAccess(actor, po.branchId);
    if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATUS_TRANSITION,
        `Cannot receive a purchase order in status ${po.status}`,
      );
    }
    const earlierSubmitters = (
      await tx.auditLog.findMany({
        where: {
          entityType: 'Purchase',
          entityId: po.id,
          action: 'purchase.submitted',
        },
        select: { actorId: true },
      })
    )
      .map((r) => r.actorId)
      .filter((v): v is string => v !== null);
    if (isBlockedReceiver(actor.id, po, earlierSubmitters))
      return { blocked: true, po };

    const branch = await tx.branch.findUniqueOrThrow({
      where: { id: po.branchId },
      select: { code: true, isActive: true },
    });
    if (!branch.isActive) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.REFERENCE_INACTIVE,
        'The receiving branch is inactive',
        [{ field: 'branchId', messages: ['branch is inactive'] }],
      );
    }

    // 2. Validate every line against the PO (I3, I5, identifier rules).
    const lines = await this.prepareLines(tx, po.id, dto);

    // 3. Receipt header and lines.
    const year = businessDate(new Date(), this.config.businessTimeZone).slice(
      0,
      4,
    );
    const n = await this.sequences.next(tx, `GRN:${branch.code}:${year}`);
    const receipt = await tx.goodsReceipt.create({
      data: {
        reference: formatGrnReference(branch.code, year, n),
        purchaseId: po.id,
        branchId: po.branchId,
        receivedById: actor.id,
        supplierDeliveryRef: dto.supplierDeliveryRef || null,
        supplierInvoiceRef: dto.supplierInvoiceRef || null,
        notes: dto.notes || null,
        idempotencyKey: dto.idempotencyKey,
        requestHash: hash,
      },
      select: { id: true, reference: true },
    });
    const itemIds = new Map(lines.map((l) => [l.purchaseItemId, randomUUID()]));
    await tx.goodsReceiptItem.createMany({
      data: lines.map((l) => ({
        id: itemIds.get(l.purchaseItemId)!,
        goodsReceiptId: receipt.id,
        purchaseItemId: l.purchaseItemId,
        productId: l.productId,
        quantity: l.quantity,
        unitCost: l.unitCost,
      })),
    });

    // 4. Serialized units + identifiers (identifier count/type re-checked by a
    //    deferred DB trigger at commit; uniqueness by DB UNIQUE).
    const unitIdsByLine = new Map<string, string[]>();
    const unitRows: Prisma.ProductUnitCreateManyInput[] = [];
    const identifierRows: Prisma.UnitIdentifierCreateManyInput[] = [];
    for (const l of lines) {
      if (!l.kind) continue;
      const ids: string[] = [];
      for (const identifiers of l.units) {
        const unitId = randomUUID();
        ids.push(unitId);
        unitRows.push({
          id: unitId,
          productId: l.productId,
          branchId: po.branchId,
          status: 'IN_STOCK',
          unitCost: l.unitCost,
          goodsReceiptItemId: itemIds.get(l.purchaseItemId)!,
        });
        identifiers.forEach((value, i) =>
          identifierRows.push({
            productUnitId: unitId,
            type: l.kind!,
            value,
            isPrimary: i === 0,
          }),
        );
      }
      unitIdsByLine.set(l.purchaseItemId, ids);
    }
    if (unitRows.length > 0) {
      await tx.productUnit.createMany({ data: unitRows });
      await tx.unitIdentifier.createMany({ data: identifierRows });
    }

    // 5. PO line quantities (Module 4 hook; CHECK forbids exceeding ordered).
    for (const l of lines) {
      await tx.purchaseItem.update({
        where: { id: l.purchaseItemId },
        data: { quantityReceived: { increment: l.quantity } },
      });
    }

    // 6. Stock: valuation locks (sorted), then per product in sorted order.
    const sorted = [...lines].sort((a, b) =>
      a.productId < b.productId ? -1 : 1,
    );
    await this.ledger.lockValuations(
      tx,
      sorted.map((l) => l.productId),
    );
    for (const l of sorted) {
      await this.ledger.increase(tx, {
        productId: l.productId,
        branchId: po.branchId,
        quantity: l.quantity,
        unitCost: l.unitCost,
        movementType: 'PURCHASE_RECEIPT',
        productUnitIds: unitIdsByLine.get(l.purchaseItemId),
        referenceType: 'GOODS_RECEIPT',
        referenceId: receipt.id,
        actorId: actor.id,
      });
    }

    // 7. PO status: RECEIVED when every line is complete, else PARTIALLY_RECEIVED.
    const outstanding = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "purchase_items"
      WHERE "purchase_id" = ${po.id}::uuid AND "quantity_received" < "quantity_ordered"`;
    const nextStatus =
      outstanding[0].n === 0 ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    if (nextStatus !== po.status) {
      const { count } = await tx.purchase.updateMany({
        where: {
          id: po.id,
          status: po.status as 'APPROVED' | 'PARTIALLY_RECEIVED',
        },
        data: { status: nextStatus, updatedById: actor.id },
      });
      if (count !== 1)
        throw new Error(
          'purchase status changed concurrently despite the row lock',
        );
    }

    // 8. Audit (same transaction).
    const linesMeta = lines.map((l) => ({
      sku: l.sku,
      purchaseItemId: l.purchaseItemId,
      quantity: l.quantity,
      units: l.kind ? l.units.length : undefined,
    }));
    await this.audit.record(
      {
        action: 'goods_receipt.created',
        entityType: 'GoodsReceipt',
        entityId: receipt.id,
        branchId: po.branchId,
        actorId: actor.id,
        metadata: {
          reference: receipt.reference,
          purchaseReference: po.reference,
          lines: linesMeta,
          unitCount: unitRows.length,
          supplierDeliveryRef: dto.supplierDeliveryRef ?? null,
          supplierInvoiceRef: dto.supplierInvoiceRef ?? null,
        },
        context,
      },
      tx,
    );
    await this.audit.record(
      {
        action:
          nextStatus === 'RECEIVED'
            ? 'purchase.received'
            : 'purchase.partially_received',
        entityType: 'Purchase',
        entityId: po.id,
        branchId: po.branchId,
        actorId: actor.id,
        metadata: {
          reference: po.reference,
          goodsReceipt: receipt.reference,
          fromStatus: po.status,
        },
        context,
      },
      tx,
    );
    return { blocked: false, receiptId: receipt.id };
  }

  /** I3 (no over-receiving), I5, identifier rules (D3, BR-17). */
  private async prepareLines(
    tx: Tx,
    purchaseId: string,
    dto: ReceiveGoodsDto,
  ): Promise<PreparedLine[]> {
    const poItems = await tx.purchaseItem.findMany({
      where: { purchaseId },
      select: {
        id: true,
        productId: true,
        quantityOrdered: true,
        quantityReceived: true,
        unitCost: true,
        product: {
          select: {
            sku: true,
            trackingMode: true,
            identifierType: true,
            identifiersPerUnit: true,
          },
        },
      },
    });
    const byId = new Map(poItems.map((i) => [i.id, i]));

    const shape: FieldErrorDetail[] = [];
    const over: FieldErrorDetail[] = [];
    const counts: FieldErrorDetail[] = [];
    const formats: FieldErrorDetail[] = [];
    const seenItems = new Set<string>();
    const lines: PreparedLine[] = [];

    dto.items.forEach((item, idx) => {
      const f = `items.${idx}`;
      const poItem = byId.get(item.purchaseItemId);
      if (!poItem) {
        shape.push({
          field: `${f}.purchaseItemId`,
          messages: ['not a line of this purchase order'],
        });
        return;
      }
      if (seenItems.has(item.purchaseItemId)) {
        shape.push({
          field: `${f}.purchaseItemId`,
          messages: ['line appears more than once'],
        });
        return;
      }
      seenItems.add(item.purchaseItemId);
      const outstanding = poItem.quantityOrdered - poItem.quantityReceived;
      if (item.quantity > outstanding) {
        over.push({
          field: `${f}.quantity`,
          messages: [
            `only ${outstanding} unit(s) outstanding for ${poItem.product.sku}`,
          ],
        });
      }
      const p = poItem.product;
      let units: string[][] = [];
      let kind: IdentifierKind | null = null;
      if (p.trackingMode === 'SERIALIZED') {
        kind = p.identifierType as IdentifierKind;
        const r = prepareSerialUnits(
          kind,
          p.identifiersPerUnit ?? 1,
          item.quantity,
          item.units,
          f,
        );
        counts.push(
          ...r.countProblems.map((x) => ({
            field: x.field,
            messages: [x.message],
          })),
        );
        formats.push(
          ...r.formatProblems.map((x) => ({
            field: x.field,
            messages: [x.message],
          })),
        );
        units = r.units;
      } else if (item.units && item.units.length > 0) {
        counts.push({
          field: `${f}.units`,
          messages: [`${p.sku} is quantity-tracked; do not send units`],
        });
      }
      lines.push({
        purchaseItemId: poItem.id,
        productId: poItem.productId,
        quantity: item.quantity,
        unitCost: poItem.unitCost,
        kind,
        units,
        sku: p.sku,
      });
    });

    if (shape.length) throw validation(shape);
    if (counts.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.IDENTIFIER_COUNT_MISMATCH,
        'Units/identifiers do not match the quantities',
        counts,
      );
    }
    if (formats.length) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.INVALID_IDENTIFIER,
        'One or more identifiers are invalid',
        formats,
      );
    }
    if (over.length) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.OVER_RECEIVING,
        'Receiving more than is outstanding is not allowed',
        over,
      );
    }

    const all = lines.flatMap((l) => l.units.flat());
    const repeated = repeatedValues(all);
    if (repeated.length) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.DUPLICATE_IDENTIFIER,
        'Identifiers repeated within the request',
        [
          {
            field: 'items',
            messages: repeated.map((v) => `${v} appears more than once`),
          },
        ],
      );
    }
    if (all.length) {
      const existing = await tx.unitIdentifier.findMany({
        where: { value: { in: all } },
        select: { value: true },
      });
      if (existing.length) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.DUPLICATE_IDENTIFIER,
          'Identifiers already registered',
          [
            {
              field: 'items',
              messages: existing.map((e) => `${e.value} is already registered`),
            },
          ],
        );
      }
    }
    return lines;
  }

  private async lockPo(tx: Tx, id: string): Promise<LockedPo> {
    const [row] = await tx.$queryRaw<
      {
        id: string;
        reference: string;
        status: string;
        branch_id: string;
        created_by_id: string;
        submitted_by_id: string | null;
        approved_by_id: string | null;
      }[]
    >`SELECT id, reference, status, branch_id, created_by_id, submitted_by_id, approved_by_id
      FROM "purchases" WHERE id = ${id}::uuid FOR UPDATE`;
    if (!row) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Purchase order not found',
      );
    }
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      branchId: row.branch_id,
      createdById: row.created_by_id,
      submittedById: row.submitted_by_id,
      approvedById: row.approved_by_id,
    };
  }

  /**
   * I19: same key + same request (purchase, payload, user) → the original
   * receipt; same key + anything different → 409 IDEMPOTENCY_KEY_REUSED.
   */
  private async findReplay(
    key: string,
    hash: string,
    purchaseId: string,
    actorId: string,
  ): Promise<string | null> {
    const existing = await this.prisma.goodsReceipt.findUnique({
      where: { idempotencyKey: key },
      select: {
        id: true,
        requestHash: true,
        purchaseId: true,
        receivedById: true,
      },
    });
    if (!existing) return null;
    if (
      existing.requestHash === hash &&
      existing.purchaseId === purchaseId &&
      existing.receivedById === actorId
    ) {
      return existing.id;
    }
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.IDEMPOTENCY_KEY_REUSED,
      'This idempotency key was already used for a different request',
    );
  }
}

function validation(details: FieldErrorDetail[]): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Validation failed',
    details,
  );
}
