import { ArgumentMetadata, HttpStatus } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import {
  IsMoneyAmount,
  MONEY_AMOUNT_PATTERN,
} from './is-money-amount.decorator';
import { toMoneyString } from './money';
import { createValidationPipe } from './validation.pipe';

class LineDto {
  @IsInt()
  @Min(1)
  quantity: number;
}

class SampleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsMoneyAmount()
  amount: string;

  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines: LineDto[];
}

const meta: ArgumentMetadata = { type: 'body', metatype: SampleDto };

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();

  it('accepts and transforms a valid payload', async () => {
    const out = await pipe.transform(
      { name: 'Laptop', amount: '1750000.00', lines: [{ quantity: 1 }] },
      meta,
    );
    expect(out).toBeInstanceOf(SampleDto);
  });

  it('throws VALIDATION_ERROR with flattened, nested field details', async () => {
    const err: unknown = await pipe
      .transform({ name: '', amount: '12.345', lines: [{ quantity: 0 }] }, meta)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppException);
    const ex = err as AppException;
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(ex.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(ex.details?.map((d) => d.field).sort()).toEqual([
      'amount',
      'lines.0.quantity',
      'name',
    ]);
  });

  it('rejects unknown properties (never trust extra client fields, e.g. totals)', async () => {
    const err = (await pipe
      .transform({ name: 'x', amount: '1', lines: [], total: '1' }, meta)
      .catch((e: unknown) => e)) as AppException;
    expect(err.details).toEqual([
      { field: 'total', messages: ['property total should not exist'] },
    ]);
  });
});

describe('money', () => {
  it.each(['0', '1', '1750000', '1750000.5', '1750000.50', '999999999999.99'])(
    'accepts %s',
    (v) => expect(MONEY_AMOUNT_PATTERN.test(v)).toBe(true),
  );

  it.each(['-1', '1.234', '01', '1e6', '', '1,000', '1000000000000', ' 1'])(
    'rejects %p',
    (v) => expect(MONEY_AMOUNT_PATTERN.test(v)).toBe(false),
  );

  it('rejects a JSON number for money (no floating point)', async () => {
    const err = (await createValidationPipe()
      .transform({ name: 'x', amount: 1750000, lines: [] }, meta)
      .catch((e: unknown) => e)) as AppException;
    expect(err.details?.[0].field).toBe('amount');
  });

  it('formats Decimal money with exactly two decimals, without float error', () => {
    expect(toMoneyString(new Prisma.Decimal('1750000'))).toBe('1750000.00');
    expect(toMoneyString(new Prisma.Decimal('0.1').plus('0.2'))).toBe('0.30');
    expect(toMoneyString('999999999999.99')).toBe('999999999999.99');
  });
});
