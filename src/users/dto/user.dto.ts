import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ROLE_KEYS, type RoleKey } from '../../access/permissions';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { PASSWORD_MAX_LENGTH } from '../../auth/password.service';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @ApiProperty({ example: 'cashier.kariakoo@electrocore.local' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'Asha Mushi' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  @ApiProperty({
    format: 'password',
    minLength: 12,
    description: 'Initial password (policy: ≥ 12 chars)',
  })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  @ApiProperty({ enum: ROLE_KEYS })
  @IsIn(ROLE_KEYS)
  roleKey: RoleKey;

  @ApiProperty({
    type: [String],
    description:
      'Assigned branch IDs. Required (≥ 1) for branch-scoped roles; CASHIER/TECHNICIAN max 1; must be empty for SYSTEM_ADMIN.',
  })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  branchIds: string[];
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({ enum: ROLE_KEYS })
  @IsOptional()
  @IsIn(ROLE_KEYS)
  roleKey?: RoleKey;

  @ApiPropertyOptional({
    description: 'false = deactivate (revokes all sessions)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Replaces all branch assignments (validated against the final role)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  branchIds?: string[];
}

export class ResetPasswordDto {
  @ApiProperty({ format: 'password', minLength: 12 })
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search email or name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: ROLE_KEYS })
  @IsOptional()
  @IsIn(ROLE_KEYS)
  roleKey?: RoleKey;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
