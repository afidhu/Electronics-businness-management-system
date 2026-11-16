import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { MAX_LINE_QUANTITY, MAX_SALE_LINES } from '../pricing';

const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class PosCatalogueQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Selling branch. Optional for single-branch users; required for SYSTEM_ADMIN (S10).',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ description: 'Search product name, SKU or brand' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Only products with available stock' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  inStockOnly?: boolean;
}

export class PosUnitsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional({
    description: 'Serialized product to list available units for',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({
    description: 'Scanned IMEI/serial: resolve to one available unit',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  identifier?: string;
}

export class QuoteItemDto {
  @ApiProperty()
  @IsUUID()
  productId: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_LINE_QUANTITY,
    description: 'Quantity products only (serialized lines are always 1 unit)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Serialized: the chosen unit id …' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @ApiPropertyOptional({ description: '… or its scanned IMEI/serial' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  identifier?: string;
}

/** No prices or totals: the server prices everything (FR-SALE-03, BR-09). */
export class QuoteDto {
  @ApiPropertyOptional({ description: 'Selling branch (see catalogue)' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty({ type: [QuoteItemDto], minItems: 1, maxItems: MAX_SALE_LINES })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SALE_LINES)
  @ValidateNested({ each: true })
  @Type(() => QuoteItemDto)
  items: QuoteItemDto[];
}
