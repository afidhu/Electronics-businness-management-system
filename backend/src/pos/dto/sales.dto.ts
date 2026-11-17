import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { IsMoneyAmount } from '../../common/validation/is-money-amount.decorator';
import {
  MAX_PAYMENTS,
  MAX_SALE_LINES,
  PAYMENT_METHODS,
  type PaymentMethodKey,
} from '../pricing';
import { QuoteItemDto } from './pos.dto';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class PaymentDto {
  @ApiProperty({ enum: PAYMENT_METHODS })
  @IsIn(PAYMENT_METHODS)
  method: PaymentMethodKey;

  @ApiProperty({
    example: '600400.00',
    description: 'Amount applied to the sale',
  })
  @IsMoneyAmount()
  amount: string;

  @ApiPropertyOptional({
    example: '601000.00',
    description: 'CASH only: cash handed over (change = tendered − amount)',
  })
  @IsOptional()
  @IsMoneyAmount()
  amountTendered?: string;

  @ApiPropertyOptional({
    description:
      'Required for MOBILE_MONEY and BANK_TRANSFER (transaction id); optional for CARD. Never card numbers.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;
}

/**
 * Checkout (FR-SALE-02..07, S4, S16). No prices, totals or tax are accepted:
 * the server prices everything (FR-SALE-03); unknown fields → 400.
 */
export class CheckoutDto {
  @ApiProperty({
    description:
      'Client-generated UUID; mandatory (S16). A retry with the same key returns the original sale.',
  })
  @IsUUID()
  idempotencyKey: string;

  @ApiPropertyOptional({
    description: 'Selling branch (required for SYSTEM_ADMIN)',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Optional customer (walk-in if absent)' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ type: [QuoteItemDto], minItems: 1, maxItems: MAX_SALE_LINES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SALE_LINES)
  @ValidateNested({ each: true })
  @Type(() => QuoteItemDto)
  items: QuoteItemDto[];

  @ApiProperty({ type: [PaymentDto], minItems: 1, maxItems: MAX_PAYMENTS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAYMENTS)
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments: PaymentDto[];
}

export class SalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Business date YYYY-MM-DD (inclusive)' })
  @IsOptional()
  @Matches(DATE, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ description: 'Business date YYYY-MM-DD (inclusive)' })
  @IsOptional()
  @Matches(DATE, { message: 'to must be YYYY-MM-DD' })
  to?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cashierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;

  @ApiPropertyOptional({ description: 'Exact receipt number' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  receiptNumber?: string;
}

export class SalesSummaryQueryDto {
  @ApiPropertyOptional({
    description: 'Business date YYYY-MM-DD (default: today)',
  })
  @IsOptional()
  @Matches(DATE, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({
    description: 'One branch; default: every branch in scope',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
