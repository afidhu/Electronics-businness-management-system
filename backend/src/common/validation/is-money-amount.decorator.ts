import { applyDecorators } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';

/**
 * Money is exchanged as a decimal STRING, never a JSON number, so no value
 * ever passes through binary floating point (BR-08, ADR-011).
 * Accepts a non-negative amount with up to 12 integer digits and up to
 * 2 decimal places — the range of the `Decimal(14,2)` database columns.
 * Examples: "1750000", "1750000.5", "1750000.50".
 */
export const MONEY_AMOUNT_PATTERN = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;

export function IsMoneyAmount(): PropertyDecorator {
  return applyDecorators(
    IsString({
      message: '$property must be a decimal string, e.g. "1750000.00"',
    }),
    Matches(MONEY_AMOUNT_PATTERN, {
      message:
        '$property must be a non-negative amount with at most 2 decimal places',
    }),
  );
}
