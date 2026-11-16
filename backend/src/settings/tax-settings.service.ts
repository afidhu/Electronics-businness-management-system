import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { RequestContext } from '../common/request-context/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Pick<PrismaService, 'taxSetting'> | Prisma.TransactionClient;

export interface ActiveTaxRate {
  id: string;
  name: string;
  ratePercent: Prisma.Decimal;
  createdAt: Date;
}

/**
 * Organisation-wide VAT (S1, BR-20, ADR-031). One active row; every change
 * inserts a new row and deactivates the previous one, so the rates used by
 * earlier sales (snapshotted on each sale) stay in history.
 */
@Injectable()
export class TaxSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findActive(db: Db = this.prisma): Promise<ActiveTaxRate | null> {
    return db.taxSetting.findFirst({
      where: { isActive: true },
      select: { id: true, name: true, ratePercent: true, createdAt: true },
    });
  }

  /**
   * Sales guard (BR-20): the active rate, or 409 TAX_NOT_CONFIGURED.
   * Quote and checkout (stages 6.3/6.4) call this inside their transaction.
   */
  async requireActive(db: Db = this.prisma): Promise<ActiveTaxRate> {
    const active = await this.findActive(db);
    if (!active) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.TAX_NOT_CONFIGURED,
        'Sales are blocked until an administrator configures the VAT rate',
      );
    }
    return active;
  }

  async current() {
    const active = await this.prisma.taxSetting.findFirst({
      where: { isActive: true },
      select: {
        name: true,
        ratePercent: true,
        createdAt: true,
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!active) return { configured: false as const };
    return {
      configured: true as const,
      name: active.name,
      ratePercent: active.ratePercent.toFixed(2),
      effectiveFrom: active.createdAt,
      setBy: active.createdBy,
    };
  }

  /** settings:write only (guarded at the route). Same rate → no-op. */
  async setRate(
    ratePercent: string,
    actor: AuthenticatedUser,
    context: RequestContext,
  ) {
    const next = new Prisma.Decimal(ratePercent);
    try {
      await this.prisma.$transaction(async (tx) => {
        // Serialise concurrent changes on the current active row.
        const [current] = await tx.$queryRaw<
          { id: string; rate_percent: Prisma.Decimal }[]
        >`
          SELECT id, rate_percent FROM "tax_settings" WHERE is_active FOR UPDATE`;
        if (current && new Prisma.Decimal(current.rate_percent).equals(next))
          return;
        if (current) {
          await tx.taxSetting.update({
            where: { id: current.id },
            data: { isActive: false },
          });
        }
        const created = await tx.taxSetting.create({
          data: { ratePercent: next, createdById: actor.id },
          select: { id: true },
        });
        await this.audit.record(
          {
            action: 'tax_setting.changed',
            entityType: 'TaxSetting',
            entityId: created.id,
            actorId: actor.id,
            metadata: {
              name: 'VAT',
              fromPercent: current
                ? new Prisma.Decimal(current.rate_percent).toFixed(2)
                : null,
              toPercent: next.toFixed(2),
            },
            context,
          },
          tx,
        );
      });
    } catch (e) {
      // First-ever configuration raced by two admins: the one-active index decided.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          'The VAT rate was changed concurrently; reload and try again',
        );
      }
      throw e;
    }
    return this.current();
  }
}
