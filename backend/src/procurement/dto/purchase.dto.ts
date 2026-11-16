import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { IsMoneyAmount } from '../../common/validation/is-money-amount.decorator';
import { MAX_LINES, MAX_QUANTITY } from '../procurement-rules';

export const PURCHASE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;

const toText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Money string strictly greater than zero (P8). Use with @IsMoneyAmount. */
function IsPositiveAmount(): PropertyDecorator {
  return ValidateBy({
    name: 'isPositiveAmount',
    validator: {
      validate: (v: unknown) =>
        typeof v === 'string' && !/^0+(\.0{1,2})?$/.test(v),
      defaultMessage: () => '$property must be greater than 0',
    },
  });
}

/** Real calendar date in YYYY-MM-DD form (no time, no timezone). */
function IsCalendarDate(): PropertyDecorator {
  return ValidateBy({
    name: 'isCalendarDate',
    validator: {
      validate: (v: unknown) => {
        if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))
          return false;
        const d = new Date(`${v}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
      },
      defaultMessage: () => '$property must be a valid date (YYYY-MM-DD)',
    },
  });
}

export class PurchaseItemDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiProperty({
    minimum: 1,
    maximum: MAX_QUANTITY,
    description: 'Whole units (P7)',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY)
  quantity: number;

  @ApiProperty({
    example: '1400000.00',
    description: 'TZS, > 0, tax-exclusive (P8)',
  })
  @IsMoneyAmount()
  @IsPositiveAmount()
  unitCost: string;
}

export class CreatePurchaseDto {
  @ApiProperty({ description: 'Destination branch (must be in your scope)' })
  @IsUUID()
  branchId: string;

  @ApiProperty()
  @IsUUID()
  supplierId: string;

  @ApiPropertyOptional({
    example: 'QT-2026-0457',
    description: 'Supplier quote/proforma reference',
  })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(100)
  supplierReference?: string;

  @ApiPropertyOptional({
    example: '2026-11-25',
    description: 'Optional; not in the past (P16)',
  })
  @IsOptional()
  @IsCalendarDate()
  expectedDeliveryDate?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [PurchaseItemDto], minItems: 1, maxItems: MAX_LINES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items: PurchaseItemDto[];
}

/**
 * Edit a DRAFT. The branch cannot change (it is part of the reference);
 * `items`, when given, replaces all lines.
 */
export class UpdatePurchaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toText)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  supplierReference?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsCalendarDate()
  expectedDeliveryDate?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toText)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({
    type: [PurchaseItemDto],
    description: 'Replaces all lines',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items?: PurchaseItemDto[];
}

export class ApprovePurchaseDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReasonDto {
  @ApiProperty({
    minLength: 5,
    maxLength: 500,
    example: 'Supplier quotation expired',
  })
  @Transform(toText)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class PurchaseQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PURCHASE_STATUSES })
  @IsOptional()
  @IsIn(PURCHASE_STATUSES)
  status?: (typeof PURCHASE_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ description: 'Search reference or supplier name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Created at or after (ISO-8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdFrom?: Date;

  @ApiPropertyOptional({ description: 'Created before (ISO-8601)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  createdTo?: Date;

  @ApiPropertyOptional({
    description:
      'SUBMITTED orders the caller may approve (excludes own created/submitted)',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  awaitingMyApproval?: boolean;
}
