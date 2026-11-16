import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Standard `?page=&limit=` query for every list endpoint (NFR-PERF-02).
 * Extend it in feature DTOs to add safe, whitelisted filters.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;
}

/** Prisma `skip`/`take` for a validated pagination query. */
export function toSkipTake(query: PaginationQueryDto): {
  skip: number;
  take: number;
} {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Returned by list services; the response interceptor moves `pagination`
 * into `meta`, producing `{ data: [...], meta: { requestId, pagination } }`.
 */
export class PaginatedResult<T> {
  readonly pagination: PaginationMeta;

  constructor(
    readonly items: T[],
    total: number,
    query: PaginationQueryDto,
  ) {
    this.pagination = {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    };
  }
}
