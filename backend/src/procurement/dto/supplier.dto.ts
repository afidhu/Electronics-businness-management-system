import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { cleanName } from '../../catalogue/catalogue-rules';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { normaliseTin } from '../procurement-rules';

const toName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? cleanName(value) : value;
const toText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const toEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const toTin = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? normaliseTin(value) : value;
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;
const PHONE = /^[0-9+() -]{5,30}$/;

export class CreateSupplierDto {
  @ApiProperty({ example: 'Techno Distributors Ltd', maxLength: 150 })
  @Transform(toName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @Transform(toName)
  @IsString()
  @MaxLength(150)
  contactPerson?: string;

  @ApiPropertyOptional({ example: '+255 22 211 0000' })
  @IsOptional()
  @Transform(toText)
  @Matches(PHONE, { message: 'phone contains invalid characters' })
  phone?: string;

  @ApiPropertyOptional({ example: 'sales@techno.co.tz' })
  @IsOptional()
  @Transform(toEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({
    example: '123-456-789',
    description:
      'Tanzanian TIN; 9 digits (dashes/spaces ignored); unique when set',
  })
  @IsOptional()
  @Transform(toTin)
  @Matches(/^\d{9}$/, { message: 'tin must be 9 digits' })
  tin?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** PATCH: optional fields; `null` clears an optional field. */
export class UpdateSupplierDto {
  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @Transform(toName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toName)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(150)
  contactPerson?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toText)
  @ValidateIf((_, v) => v !== null)
  @Matches(PHONE, { message: 'phone contains invalid characters' })
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toEmail)
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toText)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toTin)
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{9}$/, { message: 'tin must be 9 digits' })
  tin?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toText)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({
    description: 'false = deactivate (409 while open orders exist)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SupplierQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search name, contact person or TIN' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;
}
