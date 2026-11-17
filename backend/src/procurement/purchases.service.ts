import { HttpStatus, Injectable } from '@nestjs/common';
import { BranchAccessService } from '../access/branch-access.service';
import { PERMISSIONS } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { permissionDenied } from '../auth/guards/permissions.guard';
import { changedFields } from '../catalogue/change-set';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { PaginatedResult, toSkipTake } from '../common/pagination/pagination';
import type { RequestContext } from '../common/request-context/request-context';
import { businessDate } from '../common/time/business-time';
import { toMoneyString } from '../common/validation/money';
import { AppConfigService } from '../config/app-config.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentSequenceService } from './document-sequence.service';
import {
  ApprovePurchaseDto,
  CreatePurchaseDto,
  PurchaseItemDto,
  PurchaseQueryDto,
  ReasonDto,
  UpdatePurchaseDto,
} from './dto/purchase.dto';
import {
  computeLines,
  duplicateProductIds,
  formatPoReference,
  isActionAllowed,
  isSelfApproval,
  poSequenceScope,
  TARGET,
  type ComputedLine,
  type PurchaseAction,
  type PurchaseStatusValue,
} from './procurement-rules';

const PERSON = { select: { id: true, fullName: true } } as const;

const PURCHASE_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  branch: { select: { id: true, code: true, name: true } },
  createdBy: PERSON,
  updatedBy: PERSON,
  submittedBy: PERSON,
  approvedBy: PERSON,
  rejectedBy: PERSON,
  cancelledBy: PERSON,
  items: {
    orderBy: { lineNumber: 'asc' },
    include: {
      product: {
        select: {
          sku: true,
          trackingMode: true,
          identifierType: true,
          identifiersPerUnit: true,
        },
      },
    },
  },
} as const satisfies Prisma.PurchaseInclude;

type PurchaseRow = Prisma.PurchaseGetPayload<{
  include: typeof PURCHASE_INCLUDE;
}>;
type Tx = Prisma.TransactionClient;

interface LockedOrder {
  id: string;
  reference: string;
  status: PurchaseStatusValue;
  branchId: string;
  supplierId: string;
  createdById: string;
  submittedById: string | null;
}

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly sequences: DocumentSequenceService,
    private readonly config: AppConfigService,
  ) {}

  // ------------------------------------------------------------ reading --

  /**
   * Response mapper. Every procurement:read holder also has catalogue:cost_read
   * today (tested invariant); costs are still masked defensively if not.
   */
  toResponse(row: PurchaseRow, user: AuthenticatedUser) {
    const showCost = user.permissions.has(PERMISSIONS.CATALOGUE_COST_READ);
    const money = (v: Prisma.Decimal) =>
      showCost ? toMoneyString(v) : undefined;
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      branch: row.branch,
      supplier: row.supplier,
      currency: row.currency,
      pricesIncludeTax: false as const,
      subtotal: money(row.subtotal),
      supplierReference: row.supplierReference,
      expectedDeliveryDate: row.expectedDeliveryDate
        ? row.expectedDeliveryDate.toISOString().slice(0, 10)
        : null,
      notes: row.notes,
      items: row.items.map((i) => ({
        // Line id: the `purchaseItemId` that receiving (POST /purchases/:id/receive) needs.
        id: i.id,
        lineNumber: i.lineNumber,
        productId: i.productId,
        sku: i.product.sku,
        productName: i.productName,
        trackingMode: i.product.trackingMode,
        identifierType: i.product.identifierType,
        identifiersPerUnit: i.product.identifiersPerUnit,
        quantityOrdered: i.quantityOrdered,
        quantityReceived: i.quantityReceived,
        unitCost: money(i.unitCost),
        lineTotal: money(i.lineTotal),
      })),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
      submittedBy: row.submittedBy,
      submittedAt: row.submittedAt,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      approvalNote: row.approvalNote,
      rejectedBy: row.rejectedBy,
      rejectedAt: row.rejectedAt,
      rejectionReason: row.rejectionReason,
      cancelledBy: row.cancelledBy,
      cancelledAt: row.cancelledAt,
      cancellationReason: row.cancellationReason,
    };
  }

  async list(query: PurchaseQueryDto, user: AuthenticatedUser) {
    if (query.branchId) this.branchAccess.assertCanAccess(user, query.branchId);
    const q = query.q?.trim();
    const awaiting = query.awaitingMyApproval === true;
    const canApprove = user.permissions.has(PERMISSIONS.PROCUREMENT_APPROVE);

    const where: Prisma.PurchaseWhereInput = {
      branchId: query.branchId ?? this.branchAccess.scopeFilter(user),
      status: awaiting ? 'SUBMITTED' : query.status,
      supplierId: query.supplierId,
      createdAt: { gte: query.createdFrom, lt: query.createdTo },
      ...(q
        ? {
            OR: [
              { reference: { contains: q.toUpperCase() } },
              { supplier: { name: { contains: q, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(awaiting
        ? canApprove
          ? { createdById: { not: user.id }, submittedById: { not: user.id } }
          : { id: { in: [] } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchase.findMany({
        where,
        include: PURCHASE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.purchase.count({ where }),
    ]);
    return new PaginatedResult(
      rows.map((r) => this.toResponse(r, user)),
      total,
      query,
    );
  }

  async get(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.purchase.findUnique({
      where: { id },
      include: PURCHASE_INCLUDE,
    });
    if (!row) throw notFound();
    this.branchAccess.assertCanAccess(user, row.branchId);
    return this.toResponse(row, user);
  }

  // ----------------------------------------------------------- creating --

  async create(
    dto: CreatePurchaseDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    this.branchAccess.assertCanAccess(actor, dto.branchId);
    this.assertNotInPast(dto.expectedDeliveryDate);
    const computed = this.computeOrThrow(dto.items);

    const id = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.findUnique({
        where: { id: dto.branchId },
        select: { code: true, isActive: true },
      });
      if (!branch) throw refNotFound('Branch');
      if (!branch.isActive) throw inactive(['branchId']);
      await this.lockActiveSupplier(tx, dto.supplierId);
      const names = await this.activeProductNames(tx, dto.items);

      const year = businessDate(new Date(), this.config.businessTimeZone).slice(
        0,
        4,
      );
      const n = await this.sequences.next(
        tx,
        poSequenceScope(branch.code, year),
      );
      const reference = formatPoReference(branch.code, year, n);

      const created = await tx.purchase.create({
        data: {
          reference,
          branchId: dto.branchId,
          supplierId: dto.supplierId,
          currency: this.config.currency,
          subtotal: computed.subtotal,
          supplierReference: dto.supplierReference || null,
          expectedDeliveryDate: toDateOnly(dto.expectedDeliveryDate),
          notes: dto.notes || null,
          createdById: actor.id,
          updatedById: actor.id,
          items: { create: lineRows(computed.lines, names) },
        },
        select: { id: true },
      });
      await this.audit.record(
        {
          action: 'purchase.created',
          entityType: 'Purchase',
          entityId: created.id,
          branchId: dto.branchId,
          actorId: actor.id,
          metadata: {
            reference,
            supplierId: dto.supplierId,
            subtotal: toMoneyString(computed.subtotal),
            lines: summariseLines(computed.lines),
          },
          context,
        },
        tx,
      );
      return created.id;
    });
    return this.get(id, actor);
  }

  /** Edit a DRAFT (P4: any procurement:write user with branch access). */
  async update(
    id: string,
    dto: UpdatePurchaseDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    this.assertNotInPast(dto.expectedDeliveryDate ?? undefined);
    const computed = dto.items ? this.computeOrThrow(dto.items) : null;

    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockScoped(tx, id, actor);
      if (order.status !== 'DRAFT') {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.PURCHASE_NOT_EDITABLE,
          `Only DRAFT purchase orders can be edited (current status ${order.status})`,
        );
      }
      const before = await tx.purchase.findUniqueOrThrow({
        where: { id },
        include: { items: { orderBy: { lineNumber: 'asc' } } },
      });
      if (
        dto.supplierId !== undefined &&
        dto.supplierId !== before.supplierId
      ) {
        await this.lockActiveSupplier(tx, dto.supplierId);
      }
      if (computed && dto.items) {
        const names = await this.activeProductNames(tx, dto.items);
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
        await tx.purchaseItem.createMany({
          data: lineRows(computed.lines, names).map((l) => ({
            ...l,
            purchaseId: id,
          })),
        });
      }
      const after = await tx.purchase.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          supplierReference: emptyToNull(dto.supplierReference),
          expectedDeliveryDate:
            dto.expectedDeliveryDate === undefined
              ? undefined
              : toDateOnly(dto.expectedDeliveryDate ?? undefined),
          notes: emptyToNull(dto.notes),
          subtotal: computed ? computed.subtotal : undefined,
          updatedById: actor.id,
        },
      });

      const changes = changedFields(before, after, [
        'supplierId',
        'supplierReference',
        'expectedDeliveryDate',
        'notes',
        'subtotal',
      ]);
      const lineChange = computed
        ? {
            from: summariseLines(
              before.items.map((i) => ({
                productId: i.productId,
                quantity: i.quantityOrdered,
                unitCost: toMoneyString(i.unitCost),
              })),
            ),
            to: summariseLines(computed.lines),
          }
        : undefined;
      if (Object.keys(changes).length > 0 || lineChange) {
        await this.audit.record(
          {
            action: 'purchase.updated',
            entityType: 'Purchase',
            entityId: id,
            branchId: order.branchId,
            actorId: actor.id,
            metadata: {
              reference: order.reference,
              changes,
              ...(lineChange ? { lines: lineChange } : {}),
            },
            context,
          },
          tx,
        );
      }
    });
    return this.get(id, actor);
  }

  // -------------------------------------------------------- transitions --

  async submit(id: string, actor: AuthenticatedUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockForAction(tx, id, actor, 'submit');
      await this.assertReferencesStillActive(tx, order);
      await this.transition(tx, order, 'submit', {
        submittedById: actor.id,
        submittedAt: new Date(),
        updatedById: actor.id,
      });
      await this.recordEvent(tx, order, actor, context, 'purchase.submitted');
    });
    return this.get(id, actor);
  }

  async approve(
    id: string,
    dto: ApprovePurchaseDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    return this.decide(
      id,
      actor,
      context,
      'approve',
      {
        approvedById: actor.id,
        approvedAt: new Date(),
        approvalNote: dto.note || null,
        updatedById: actor.id,
      },
      { note: dto.note ?? null },
    );
  }

  async reject(
    id: string,
    dto: ReasonDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    return this.decide(
      id,
      actor,
      context,
      'reject',
      {
        rejectedById: actor.id,
        rejectedAt: new Date(),
        rejectionReason: dto.reason,
        updatedById: actor.id,
      },
      { reason: dto.reason },
    );
  }

  /** REJECTED → DRAFT for revision; history stays in the audit log (P2). */
  async reopen(id: string, actor: AuthenticatedUser, context: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockForAction(tx, id, actor, 'reopen');
      const previous = await tx.purchase.findUniqueOrThrow({
        where: { id },
        select: { rejectionReason: true, rejectedById: true },
      });
      await this.transition(tx, order, 'reopen', {
        submittedById: null,
        submittedAt: null,
        rejectedById: null,
        rejectedAt: null,
        rejectionReason: null,
        updatedById: actor.id,
      });
      await this.recordEvent(tx, order, actor, context, 'purchase.reopened', {
        previousRejection: previous,
      });
    });
    return this.get(id, actor);
  }

  /**
   * P5: DRAFT/SUBMITTED/REJECTED need procurement:write; APPROVED needs
   * procurement:approve and nothing received. Reason always required.
   */
  async cancel(
    id: string,
    dto: ReasonDto,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockForAction(tx, id, actor, 'cancel');
      const needed =
        order.status === 'APPROVED'
          ? PERMISSIONS.PROCUREMENT_APPROVE
          : PERMISSIONS.PROCUREMENT_WRITE;
      if (!actor.permissions.has(needed)) throw permissionDenied();
      if (order.status === 'APPROVED') {
        const received = await tx.purchaseItem.aggregate({
          where: { purchaseId: id },
          _sum: { quantityReceived: true },
        });
        if ((received._sum.quantityReceived ?? 0) > 0) {
          throw transitionError(
            'cancel',
            order.status,
            'goods have already been received',
          );
        }
      }
      await this.transition(tx, order, 'cancel', {
        cancelledById: actor.id,
        cancelledAt: new Date(),
        cancellationReason: dto.reason,
        updatedById: actor.id,
      });
      await this.recordEvent(tx, order, actor, context, 'purchase.cancelled', {
        reason: dto.reason,
        previousStatus: order.status,
      });
    });
    return this.get(id, actor);
  }

  // ------------------------------------------------------------ helpers --

  /**
   * Approve/reject with separation of duties (P3). A blocked attempt rolls
   * back the transaction, then is audited on its own and rejected with 403.
   */
  private async decide(
    id: string,
    actor: AuthenticatedUser,
    context: RequestContext,
    action: 'approve' | 'reject',
    data: Prisma.PurchaseUncheckedUpdateManyInput,
    metadata: Record<string, unknown>,
  ) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockForAction(tx, id, actor, action);
      const earlierSubmitters = await this.earlierSubmitterIds(tx, id);
      if (isSelfApproval(actor.id, order, earlierSubmitters)) {
        return { blocked: true as const, order };
      }
      if (action === 'approve')
        await this.assertReferencesStillActive(tx, order);
      await this.transition(tx, order, action, data);
      await this.recordEvent(
        tx,
        order,
        actor,
        context,
        action === 'approve' ? 'purchase.approved' : 'purchase.rejected',
        metadata,
      );
      return { blocked: false as const, order };
    });

    if (outcome.blocked) {
      await this.audit.record({
        action: 'purchase.approval_blocked',
        entityType: 'Purchase',
        entityId: id,
        branchId: outcome.order.branchId,
        actorId: actor.id,
        metadata: {
          reference: outcome.order.reference,
          attemptedAction: action,
          reason: 'actor created or submitted this purchase order',
        },
        context,
      });
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.SELF_APPROVAL_FORBIDDEN,
        'You cannot approve or reject a purchase order you created or submitted',
      );
    }
    return this.get(id, actor);
  }

  /** Row lock + branch scope + allowed-transition check. */
  private async lockForAction(
    tx: Tx,
    id: string,
    actor: AuthenticatedUser,
    action: PurchaseAction,
  ): Promise<LockedOrder> {
    const order = await this.lockScoped(tx, id, actor);
    if (!isActionAllowed(action, order.status)) {
      throw transitionError(action, order.status);
    }
    return order;
  }

  private async lockScoped(
    tx: Tx,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<LockedOrder> {
    const [row] = await tx.$queryRaw<
      {
        id: string;
        reference: string;
        status: PurchaseStatusValue;
        branch_id: string;
        supplier_id: string;
        created_by_id: string;
        submitted_by_id: string | null;
      }[]
    >`SELECT id, reference, status, branch_id, supplier_id, created_by_id, submitted_by_id
      FROM "purchases" WHERE id = ${id}::uuid FOR UPDATE`;
    if (!row) throw notFound();
    this.branchAccess.assertCanAccess(actor, row.branch_id);
    return {
      id: row.id,
      reference: row.reference,
      status: row.status,
      branchId: row.branch_id,
      supplierId: row.supplier_id,
      createdById: row.created_by_id,
      submittedById: row.submitted_by_id,
    };
  }

  /** Conditional status change: exactly one concurrent action can win. */
  private async transition(
    tx: Tx,
    order: LockedOrder,
    action: Exclude<PurchaseAction, 'edit'>,
    data: Prisma.PurchaseUncheckedUpdateManyInput,
  ) {
    const target = TARGET[action];
    const { count } = await tx.purchase.updateMany({
      where: { id: order.id, status: order.status },
      data: { ...data, status: target },
    });
    if (count !== 1) throw transitionError(action, order.status);
  }

  private async recordEvent(
    tx: Tx,
    order: LockedOrder,
    actor: AuthenticatedUser,
    context: RequestContext,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    await this.audit.record(
      {
        action,
        entityType: 'Purchase',
        entityId: order.id,
        branchId: order.branchId,
        actorId: actor.id,
        metadata: {
          reference: order.reference,
          fromStatus: order.status,
          ...extra,
        },
        context,
      },
      tx,
    );
  }

  /** Users who submitted this order in earlier cycles (reject → reopen → resubmit). */
  private async earlierSubmitterIds(
    tx: Tx,
    purchaseId: string,
  ): Promise<string[]> {
    const rows = await tx.auditLog.findMany({
      where: {
        entityType: 'Purchase',
        entityId: purchaseId,
        action: 'purchase.submitted',
      },
      select: { actorId: true },
    });
    return rows.map((r) => r.actorId).filter((v): v is string => v !== null);
  }

  /** Supplier must exist and be active; FOR SHARE blocks a concurrent deactivation. */
  private async lockActiveSupplier(tx: Tx, supplierId: string) {
    const [s] = await tx.$queryRaw<{ is_active: boolean }[]>`
      SELECT is_active FROM "suppliers" WHERE id = ${supplierId}::uuid FOR SHARE`;
    if (!s) throw refNotFound('Supplier');
    if (!s.is_active) throw inactive(['supplierId']);
  }

  /** All products must exist and be active (US-03); returns name snapshots. */
  private async activeProductNames(
    tx: Tx,
    items: readonly PurchaseItemDto[],
  ): Promise<Map<string, string>> {
    const ids = items.map((i) => i.productId);
    const products = await tx.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, isActive: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const missing = ids.filter((pid) => !byId.has(pid));
    if (missing.length > 0) throw refNotFound('Product');
    const inactiveIdx = items
      .map((i, idx) => (byId.get(i.productId)!.isActive ? -1 : idx))
      .filter((idx) => idx >= 0);
    if (inactiveIdx.length > 0)
      throw inactive(inactiveIdx.map((i) => `items.${i}.productId`));
    return new Map(products.map((p) => [p.id, p.name]));
  }

  /** Re-checked at submission and approval: nothing inactive may be bought. */
  private async assertReferencesStillActive(tx: Tx, order: LockedOrder) {
    await this.lockActiveSupplier(tx, order.supplierId);
    const lines = await tx.purchaseItem.findMany({
      where: { purchaseId: order.id },
      orderBy: { lineNumber: 'asc' },
      select: { productId: true, quantityOrdered: true },
    });
    if (lines.length === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [
          {
            field: 'items',
            messages: ['a purchase order needs at least one line'],
          },
        ],
      );
    }
    await this.activeProductNames(
      tx,
      lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantityOrdered,
        unitCost: '1',
      })),
    );
  }

  private computeOrThrow(items: readonly PurchaseItemDto[]) {
    const dupes = duplicateProductIds(items);
    if (dupes.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.DUPLICATE_PRODUCT_LINE,
        'Each product may appear only once per purchase order',
        dupes.map((pid) => ({
          field: `items.${items.findIndex((i) => i.productId === pid)}.productId`,
          messages: ['product appears on more than one line'],
        })),
      );
    }
    const computed = computeLines(items);
    if (!computed) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [
          {
            field: 'items',
            messages: [
              'order total exceeds the maximum amount (999,999,999,999.99)',
            ],
          },
        ],
      );
    }
    return computed;
  }

  /** P16: optional, but never in the past (business timezone). */
  private assertNotInPast(date: string | undefined) {
    if (!date) return;
    const today = businessDate(new Date(), this.config.businessTimeZone);
    if (date < today) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Validation failed',
        [
          {
            field: 'expectedDeliveryDate',
            messages: [`expectedDeliveryDate must not be before ${today}`],
          },
        ],
      );
    }
  }
}

// ---------------------------------------------------------------- utils --

function lineRows(lines: ComputedLine[], names: Map<string, string>) {
  return lines.map((l) => ({
    lineNumber: l.lineNumber,
    productId: l.productId,
    productName: names.get(l.productId)!,
    quantityOrdered: l.quantity,
    unitCost: l.unitCost,
    lineTotal: l.lineTotal,
  }));
}

function summariseLines(
  lines: readonly { productId: string; quantity: number; unitCost: string }[],
) {
  return lines.map((l) => ({
    productId: l.productId,
    quantity: l.quantity,
    unitCost: toMoneyString(l.unitCost),
  }));
}

function toDateOnly(date: string | undefined): Date | null {
  return date ? new Date(`${date}T00:00:00Z`) : null;
}

function emptyToNull(v: string | null | undefined): string | null | undefined {
  return v === '' ? null : v;
}

function notFound(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    'Purchase order not found',
  );
}

function refNotFound(label: 'Branch' | 'Supplier' | 'Product'): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.NOT_FOUND,
    `${label} not found`,
  );
}

function inactive(fields: string[]): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.REFERENCE_INACTIVE,
    'Inactive branches, suppliers or products cannot be used on purchase orders',
    fields.map((field) => ({
      field,
      messages: [`${field} refers to an inactive record`],
    })),
  );
}

function transitionError(
  action: PurchaseAction,
  status: string,
  detail?: string,
): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.INVALID_STATUS_TRANSITION,
    `Cannot ${action} a purchase order in status ${status}${detail ? `: ${detail}` : ''}`,
  );
}
