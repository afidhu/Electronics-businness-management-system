import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginatedResult,
  PaginationQueryDto,
  toSkipTake,
} from './pagination';

const parse = (query: Record<string, unknown>) => {
  const dto = plainToInstance(PaginationQueryDto, query, {
    exposeDefaultValues: true,
  });
  return { dto, errors: validateSync(dto) };
};

describe('PaginationQueryDto', () => {
  it('defaults to page 1 and the default page size', () => {
    const { dto, errors } = parse({});
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 1, limit: DEFAULT_PAGE_SIZE });
  });

  it('converts query-string numbers', () => {
    const { dto, errors } = parse({ page: '3', limit: '50' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 3, limit: 50 });
  });

  it.each([
    [{ page: '0' }, 'page'],
    [{ page: '1.5' }, 'page'],
    [{ limit: '0' }, 'limit'],
    [{ limit: String(MAX_PAGE_SIZE + 1) }, 'limit'],
    [{ limit: 'all' }, 'limit'],
  ])('rejects %p', (query, field) => {
    const { errors } = parse(query);
    expect(errors.map((e) => e.property)).toContain(field);
  });
});

describe('pagination helpers', () => {
  it('computes skip/take', () => {
    expect(toSkipTake({ page: 3, limit: 20 })).toEqual({ skip: 40, take: 20 });
  });

  it('computes total pages, including an empty result', () => {
    expect(
      new PaginatedResult([], 0, { page: 1, limit: 20 }).pagination.totalPages,
    ).toBe(0);
    expect(
      new PaginatedResult([], 41, { page: 1, limit: 20 }).pagination.totalPages,
    ).toBe(3);
  });
});
