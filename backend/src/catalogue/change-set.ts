/** One audited field change: `{ from, to }` (JSON-safe values). */
export interface FieldChange {
  from: unknown;
  to: unknown;
}

function comparable(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  // Prisma.Decimal and similar: compare/record their canonical string form.
  if (
    v !== null &&
    typeof v === 'object' &&
    'toFixed' in v &&
    typeof (v as { toFixed: unknown }).toFixed === 'function'
  ) {
    return (v as { toFixed: (n: number) => string }).toFixed(2);
  }
  return v;
}

/**
 * Field-by-field diff for audit metadata, e.g.
 * `{ sellingPrice: { from: "1750000.00", to: "1690000.00" } }`.
 * Only listed fields are compared; unchanged fields are omitted.
 */
export function changedFields(
  before: object,
  after: object,
  fields: readonly string[],
): Record<string, FieldChange> {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const changes: Record<string, FieldChange> = {};
  for (const f of fields) {
    const from = comparable(b[f]);
    const to = comparable(a[f]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[f] = { from, to };
  }
  return changes;
}
