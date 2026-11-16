import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Allow,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { IsMoneyAmount } from '../../common/validation/is-money-amount.decorator';
import {
  cleanName,
  normaliseSku,
  SKU_PATTERN,
  specificationProblems,
  type Specifications,
} from '../catalogue-rules';

export const TRACKING_MODES = ['SERIALIZED', 'QUANTITY'] as const;
export type TrackingModeValue = (typeof TRACKING_MODES)[number];
export const IDENTIFIER_TYPES = ['IMEI', 'SERIAL'] as const;
export type IdentifierTypeValue = (typeof IDENTIFIER_TYPES)[number];

const toName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? cleanName(value) : value;
const toText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** Flat object of text/number/boolean values (catalogue-rules). */
export function IsSpecifications(
  options?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isSpecifications',
      validator: {
        validate: (value: unknown) => specificationProblems(value).length === 0,
        defaultMessage: (args) =>
          specificationProblems(args?.value).join('; ') ||
          'invalid specifications',
      },
    },
    options,
  );
}

export class CreateProductDto {
  @ApiProperty({
    example: 'HP-PB450-G10-I5',
    description:
      '2–40 chars A–Z 0–9 . _ - ; stored upper-case; immutable; unique',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? normaliseSku(value) : value,
  )
  @IsString()
  @Matches(SKU_PATTERN, {
    message:
      'sku must be 2-40 characters: letters, digits, ".", "_" or "-", starting with a letter or digit',
  })
  sku: string;

  @ApiProperty({ example: 'HP ProBook 450 G10 i5 16GB/512GB', maxLength: 200 })
  @Transform(toName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty()
  @IsUUID()
  categoryId: string;

  @ApiProperty()
  @IsUUID()
  brandId: string;

  @ApiProperty({
    enum: TRACKING_MODES,
    description: 'Immutable after creation',
  })
  @IsIn(TRACKING_MODES)
  trackingMode: TrackingModeValue;

  @ApiPropertyOptional({
    enum: IDENTIFIER_TYPES,
    description: 'Required for SERIALIZED, forbidden for QUANTITY; immutable',
  })
  @IsOptional()
  @IsIn(IDENTIFIER_TYPES)
  identifierType?: IdentifierTypeValue;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 2,
    description: 'SERIALIZED only (default 1; 2 for dual-SIM IMEIs); immutable',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  identifiersPerUnit?: number;

  @ApiProperty({ example: '1450000.00', description: 'TZS decimal string' })
  @IsMoneyAmount()
  costPrice: string;

  @ApiProperty({
    example: '1750000.00',
    description: 'TZS decimal string, tax-exclusive',
  })
  @IsMoneyAmount()
  sellingPrice: string;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  reorderLevel?: number;

  @ApiPropertyOptional({
    example: { ram: '16GB', storage: '512GB SSD', screen_inches: 15.6 },
    description: '≤ 30 entries; values text (≤ 200), number or boolean',
  })
  @IsOptional()
  @IsSpecifications()
  specifications?: Specifications;
}

/**
 * PATCH body. Field-level permissions (ADR-025, D5): `costPrice` and
 * `sellingPrice` require catalogue:price; all other fields require
 * catalogue:write. Immutable fields are accepted by validation only so the
 * service can answer 400 IMMUTABLE_FIELD when they would change.
 */
export class UpdateProductDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(toName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @Transform(toText)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ description: 'Requires catalogue:price' })
  @IsOptional()
  @IsMoneyAmount()
  costPrice?: string;

  @ApiPropertyOptional({
    description: 'Requires catalogue:price; tax-exclusive',
  })
  @IsOptional()
  @IsMoneyAmount()
  sellingPrice?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  reorderLevel?: number;

  @ApiPropertyOptional({ description: 'Replaces all specifications' })
  @IsOptional()
  @IsSpecifications()
  specifications?: Specifications;

  @ApiPropertyOptional({ description: 'false = deactivate' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // ---- immutable (D9): rejected by the service if they differ ----
  @ApiPropertyOptional({ readOnly: true })
  @Allow()
  sku?: unknown;

  @ApiPropertyOptional({ readOnly: true })
  @Allow()
  trackingMode?: unknown;

  @ApiPropertyOptional({ readOnly: true })
  @Allow()
  identifierType?: unknown;

  @ApiPropertyOptional({ readOnly: true })
  @Allow()
  identifiersPerUnit?: unknown;
}

export const PRODUCT_SORTS = [
  'name',
  'sku',
  'sellingPrice',
  'createdAt',
] as const;

export class ProductQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search SKU or name (contains, case-insensitive)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Exact SKU (case-insensitive), e.g. from a scanner',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? normaliseSku(value) : value,
  )
  @IsString()
  @MaxLength(40)
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ enum: TRACKING_MODES })
  @IsOptional()
  @IsIn(TRACKING_MODES)
  trackingMode?: TrackingModeValue;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ enum: PRODUCT_SORTS, default: 'name' })
  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: (typeof PRODUCT_SORTS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}
