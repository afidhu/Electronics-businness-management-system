import {
  businessDate,
  businessDateTime,
  businessDayRangeUtc,
} from './business-time';

const TZ = 'Africa/Dar_es_Salaam'; // UTC+3, no daylight saving

describe('businessDate', () => {
  it('uses the business timezone, not UTC, to pick the calendar day', () => {
    // 22:30 UTC on 16 Nov is 01:30 on 17 Nov in Dar es Salaam.
    expect(businessDate(new Date('2026-11-16T22:30:00Z'), TZ)).toBe(
      '2026-11-17',
    );
    expect(businessDate(new Date('2026-11-16T20:59:59Z'), TZ)).toBe(
      '2026-11-16',
    );
    expect(businessDate(new Date('2026-11-16T22:30:00Z'), 'UTC')).toBe(
      '2026-11-16',
    );
  });
});

describe('businessDayRangeUtc', () => {
  it('returns the UTC bounds of a Dar es Salaam business day', () => {
    const { start, end } = businessDayRangeUtc('2026-11-16', TZ);
    expect(start.toISOString()).toBe('2026-11-15T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-16T21:00:00.000Z');
  });

  it('handles month and year boundaries', () => {
    const { start, end } = businessDayRangeUtc('2026-12-31', TZ);
    expect(start.toISOString()).toBe('2026-12-30T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T21:00:00.000Z');
  });

  it('is consistent with businessDate at both edges', () => {
    const { start, end } = businessDayRangeUtc('2026-11-16', TZ);
    expect(businessDate(start, TZ)).toBe('2026-11-16');
    expect(businessDate(new Date(end.getTime() - 1), TZ)).toBe('2026-11-16');
    expect(businessDate(end, TZ)).toBe('2026-11-17');
  });

  it('rejects malformed dates', () => {
    expect(() => businessDayRangeUtc('16/11/2026', TZ)).toThrow(
      /Invalid business date/,
    );
  });
});

describe('businessDateTime', () => {
  it('formats in the business timezone (EAT = UTC+3), 24-hour clock', () => {
    expect(
      businessDateTime(
        new Date('2026-11-16T21:30:05Z'),
        'Africa/Dar_es_Salaam',
      ),
    ).toBe('2026-11-17 00:30:05');
    expect(
      businessDateTime(
        new Date('2026-11-16T09:05:00Z'),
        'Africa/Dar_es_Salaam',
      ),
    ).toBe('2026-11-16 12:05:00');
  });
});
