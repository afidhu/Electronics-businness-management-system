import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { cleanName } from '../../catalogue/catalogue-rules';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { normalisePhone } from '../phone';

const toName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? cleanName(value) : value;
const toText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const toEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
/** Normalise when possible; leave the raw text for the validator to reject. */
const toPhone = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (normalisePhone(value) ?? value) : value;
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

function IsNormalisedPhone(): PropertyDecorator {
  return ValidateBy({
    name: 'isNormalisedPhone',
    validator: {
      validate: (v: unknown) => typeof v === 'string' && /^\+\d{8,15}$/.test(v),
      defaultMessage: () =>
        'phone must be a valid number, e.g. 0712 345 678 or +255 712 345 678',
    },
  });
}

export class CreateCustomerDto {
  @ApiProperty({ example: 'Asha Mushi', maxLength: 150 })
  @Transform(toName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional({
    example: '0712 345 678',
    description: 'Normalised to +255712345678; unique when set',
  })
  @IsOptional()
  @Transform(toPhone)
  @IsNormalisedPhone()
  phone?: string;

  @ApiPropertyOptional({ example: 'asha@example.co.tz' })
  @IsOptional()
  @Transform(toEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** PATCH: `null` clears phone, email or notes. */
export class UpdateCustomerDto {
  @ApiPropertyOptional({ maxLength: 150 })
  @IsOptional()
  @Transform(toName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(toPhone)
  @ValidateIf((_, v) => v !== null)
  @IsNormalisedPhone()
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
  @MaxLength(500)
  notes?: string | null;

  @ApiPropertyOptional({
    description: 'false = deactivate (customers are never deleted)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CustomerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Search name or phone (any common format)',
  })
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
