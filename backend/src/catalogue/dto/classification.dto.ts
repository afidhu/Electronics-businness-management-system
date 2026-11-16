import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination';
import { cleanName } from '../catalogue-rules';

const toName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? cleanName(value) : value;
const toText = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateBrandDto {
  @ApiProperty({ example: 'Samsung', maxLength: 100 })
  @Transform(toName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class CreateCategoryDto extends CreateBrandDto {
  @ApiPropertyOptional({
    example: 'Mobile phones and smartphones',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(toText)
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateBrandDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(toName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'false = deactivate (409 while active products use it)',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto extends UpdateBrandDto {
  @ApiPropertyOptional({
    maxLength: 500,
    nullable: true,
    description: 'null clears it',
  })
  @IsOptional()
  @Transform(toText)
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class ClassificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Search by name' })
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
