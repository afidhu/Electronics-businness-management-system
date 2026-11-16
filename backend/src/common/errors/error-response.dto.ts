import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FieldErrorDetailDto {
  @ApiProperty({ example: 'limit' })
  field: string;

  @ApiProperty({ example: ['limit must not be greater than 100'] })
  messages: string[];
}

/** Shape of every error response (documented in Swagger). */
export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code: string;

  @ApiProperty({ example: 'Validation failed' })
  message: string;

  @ApiProperty({ example: '6f1c2b1e-8a43-4c1e-9a65-2f1e3c4d5b6a' })
  requestId: string;

  @ApiPropertyOptional({ type: [FieldErrorDetailDto] })
  details?: FieldErrorDetailDto[];
}
