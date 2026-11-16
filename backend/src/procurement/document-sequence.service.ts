import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

/**
 * Atomic per-scope counters (P6). The single-statement upsert takes a row
 * lock, so concurrent transactions for the same scope get distinct values;
 * values are only consumed if the caller's transaction commits (a rollback
 * may leave a gap — acceptable and documented).
 */
@Injectable()
export class DocumentSequenceService {
  async next(tx: Prisma.TransactionClient, scope: string): Promise<number> {
    const [row] = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO "document_sequences" ("scope", "last_value", "updated_at")
      VALUES (${scope}, 1, now())
      ON CONFLICT ("scope")
      DO UPDATE SET "last_value" = "document_sequences"."last_value" + 1, "updated_at" = now()
      RETURNING "last_value"`;
    return Number(row.last_value);
  }
}
