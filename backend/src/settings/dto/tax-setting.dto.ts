import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** 0 to 100 with at most 2 decimals, as a decimal string (BR-08). */
export const TAX_RATE_PATTERN = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

export class SetTaxRateDto {
  @ApiProperty({
    example: '18.00',
    description:
      'VAT percentage 0–100 (≤ 2 decimals) as a string; "0" is allowed',
  })
  @IsString({ message: 'ratePercent must be a decimal string, e.g. "18.00"' })
  @Matches(TAX_RATE_PATTERN, {
    message:
      'ratePercent must be between 0 and 100 with at most 2 decimal places',
  })
  ratePercent: string;
}
