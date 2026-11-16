import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export const UNIT_STATUSES = [
  'IN_STOCK',
  'IN_TRANSIT',
  'RESERVED',
  'SOLD',
  'RETURNED',
  'UNDER_REPAIR',
  'WRITTEN_OFF',
] as const;

export const MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'PURCHASE_RECEIPT',
  'ADJUSTMENT_INCREASE',
  'ADJUSTMENT_DECREASE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
] as const;

export class BalanceQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;

  @ApiPropertyOptional({ description: 'Search SKU or product name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Only rows with available ≤ reorder level (I21)',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  lowStock?: boolean;
}

export class MovementQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional({ enum: MOVEMENT_TYPES })
  @IsOptional()
  @IsIn(MOVEMENT_TYPES)
  type?: (typeof MOVEMENT_TYPES)[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() referenceId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

export class UnitQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional({ enum: UNIT_STATUSES })
  @IsOptional()
  @IsIn(UNIT_STATUSES)
  status?: (typeof UNIT_STATUSES)[number];
}

export class UnitLookupDto {
  @ApiPropertyOptional({
    description: 'IMEI or serial (normalised by the server)',
  })
  @IsString()
  @MaxLength(80)
  identifier: string;
}

export class ReceiptQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() purchaseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

export class ValuationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}
