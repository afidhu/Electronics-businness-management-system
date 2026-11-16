import {
  cleanName,
  identifierProblem,
  isValidImei,
  nameKey,
  normaliseIdentifier,
  normaliseSku,
  normaliseSpecifications,
  SKU_PATTERN,
  specificationProblems,
} from './catalogue-rules';

describe('SKU rules', () => {
  it('normalises to trimmed upper case', () => {
    expect(normaliseSku('  hp-pb450-g10-i5 ')).toBe('HP-PB450-G10-I5');
  });

  it.each(['AB', 'HP-PB450', 'SAM.A15_128', 'X'.repeat(40)])(
    'accepts %s',
    (sku) => expect(SKU_PATTERN.test(sku)).toBe(true),
  );

  it.each(['A', '-ABC', 'AB CD', 'ab', 'X'.repeat(41), 'SKU#1', ''])(
    'rejects %p',
    (sku) => expect(SKU_PATTERN.test(sku)).toBe(false),
  );
});

describe('category/brand names', () => {
  it('collapses whitespace and makes a case-insensitive key', () => {
    expect(cleanName('  Smart   Phones ')).toBe('Smart Phones');
    expect(nameKey('  SMART   phones ')).toBe('smart phones');
    expect(nameKey('Laptops')).toBe(nameKey('LAPTOPS'));
  });
});

describe('specifications', () => {
  it('accepts a flat object of text, numbers and booleans', () => {
    expect(
      specificationProblems({
        ram: '16GB',
        screen_inches: 15.6,
        dual_sim: true,
        'Storage type': 'SSD',
      }),
    ).toEqual([]);
    expect(specificationProblems({})).toEqual([]);
  });

  it.each([
    [null, /object/],
    [['a'], /object/],
    ['text', /object/],
    [{ nested: { a: 1 } }, /must be text/],
    [{ list: [1, 2] }, /must be text/],
    [{ long: 'x'.repeat(201) }, /must be text/],
    [{ 'bad-key!': 'x' }, /key/],
    [{ '': 'x' }, /key/],
    [{ inf: Infinity }, /must be text/],
    [
      Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, i])),
      /at most 30/,
    ],
  ])('rejects %p', (value, problem) => {
    expect(specificationProblems(value).join(' ')).toMatch(problem);
  });

  it('trims string values', () => {
    expect(normaliseSpecifications({ ram: ' 16GB ', n: 2 })).toEqual({
      ram: '16GB',
      n: 2,
    });
  });
});

describe('serialized identifiers (used by Module 5, D3)', () => {
  it('validates IMEI check digits (Luhn)', () => {
    expect(isValidImei('490154203237518')).toBe(true);
    expect(isValidImei('352099001761481')).toBe(true);
    expect(isValidImei('490154203237519')).toBe(false); // wrong check digit
    expect(isValidImei('49015420323751')).toBe(false); // 14 digits
    expect(isValidImei('49015420323751A')).toBe(false);
  });

  it('normalises IMEIs to digits and serials to upper case, so duplicates collide', () => {
    expect(normaliseIdentifier('IMEI', '35-209900 176148 1')).toBe(
      '352099001761481',
    );
    expect(normaliseIdentifier('SERIAL', ' 5cg1234xyz ')).toBe('5CG1234XYZ');
    expect(normaliseIdentifier('SERIAL', '5cg1234xyz')).toBe(
      normaliseIdentifier('SERIAL', '5CG1234XYZ'),
    );
  });

  it('reports invalid identifiers', () => {
    expect(identifierProblem('IMEI', '352099001761481')).toBeNull();
    expect(identifierProblem('IMEI', '352099001761482')).toMatch(/check digit/);
    expect(identifierProblem('SERIAL', '5CG1234XYZ')).toBeNull();
    expect(identifierProblem('SERIAL', 'AB1')).toMatch(/4-64/);
    expect(identifierProblem('SERIAL', 'BAD SERIAL')).toMatch(/4-64/);
  });
});
