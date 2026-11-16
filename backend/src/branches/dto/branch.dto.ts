import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBranchDto {
  @ApiProperty({
    example: 'DSM01',
    description: '2–20 chars A-Z, 0-9, "-"; stored upper-case; immutable',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z0-9-]{2,20}$/, {
    message: 'code must be 2-20 characters: letters, digits or "-"',
  })
  code: string;

  @ApiProperty({ example: 'Dar es Salaam — Kariakoo' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional({ example: '+255 22 000 0000' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9+() -]{5,30}$/, {
    message: 'phone contains invalid characters',
  })
  phone?: string;
}

/** Branch code is immutable (it will appear in receipt numbers). */
export class UpdateBranchDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9+() -]{5,30}$/, {
    message: 'phone contains invalid characters',
  })
  phone?: string;

  @ApiPropertyOptional({
    description: 'false = deactivate (branches are never deleted)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BranchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search code or name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
