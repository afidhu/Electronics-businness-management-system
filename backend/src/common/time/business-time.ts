/**
 * Time conventions (BR-10, ADR-011):
 * - Every timestamp is stored in UTC (`timestamptz` columns; the DB session
 *   timezone is pinned to UTC in PrismaService) and sent as ISO-8601 with `Z`.
 * - Business dates (receipt day, warranty start, daily reports) are derived in
 *   the configured BUSINESS_TIMEZONE (default Africa/Dar_es_Salaam).
 */

/** Calendar date `YYYY-MM-DD` of `instant` as seen in `timeZone`. */
export function businessDate(instant: Date, timeZone: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. +180 for EAT). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round(
    (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000,
  );
}

/**
 * UTC instants bounding one business day: `[start, end)`.
 * Used for date-filtered queries such as "today's sales" (FR-RPT-02).
 * @param date `YYYY-MM-DD` in the business timezone.
 */
export function businessDayRangeUtc(
  date: string,
  timeZone: string,
): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid business date: ${date}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];

  const toUtc = (year: number, month: number, day: number): Date => {
    const guess = new Date(Date.UTC(year, month - 1, day));
    return new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
  };

  return { start: toUtc(y, m, d), end: toUtc(y, m, d + 1) };
}

/** `YYYY-MM-DD HH:mm:ss` of `instant` in `timeZone` (receipt display). */
export function businessDateTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
