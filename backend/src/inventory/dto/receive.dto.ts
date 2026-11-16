import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_UNITS_PER_RECEIPT } from '../inventory-rules';

const toText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ReceiveUnitDto {
  @ApiProperty({
    example: ['5CG3301ABC'],
    description:
      'Exactly identifiersPerUnit IMEI/serial values (normalised by the server)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  identifiers: string[];
}

export class ReceiveItemDto {
  @ApiProperty()
  @IsUUID()
  purchaseItemId: string;

  @ApiProperty({
    minimum: 1,
    description: 'Whole units; never above the outstanding quantity (I3)',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_UNITS_PER_RECEIPT)
  quantity: number;

  @ApiPropertyOptional({
    type: [ReceiveUnitDto],
    description:
      'SERIALIZED products only: one entry per unit (length = quantity)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_UNITS_PER_RECEIPT)
  @ValidateNested({ each: true })
  @Type(() => ReceiveUnitDto)
  units?: ReceiveUnitDto[];
}

export class ReceiveGoodsDto {
  @ApiProperty({
    description:
      'Client-generated UUID; mandatory (I19). A retry returns the original receipt.',
  })
  @IsUUID()
  idempotencyKey: string;

  @ApiPropertyOptional({
    example: 'DN-88231',
    description: 'Supplier delivery note',
  })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(100)
  supplierDeliveryRef?: string;

  @ApiPropertyOptional({
    example: 'INV-2026-1145',
    description: 'Supplier invoice (FR-PUR-06)',
  })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(100)
  supplierInvoiceRef?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ type: [ReceiveItemDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items: ReceiveItemDto[];
}
