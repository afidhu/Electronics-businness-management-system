import { normalisePhone } from './phone';

describe('normalisePhone (S6)', () => {
  it.each([
    ['0712 345 678', '+255712345678'],
    ['0712-345-678', '+255712345678'],
    ['712345678', '+255712345678'],
    ['255712345678', '+255712345678'],
    ['+255 712 345 678', '+255712345678'],
    ['+255 (712) 345-678', '+255712345678'],
    ['00255712345678', '+255712345678'],
    ['022 211 0000', '+255222110000'], // Dar es Salaam landline
    ['+44 20 7946 0958', '+442079460958'], // international kept
    ['  0754.111.222 ', '+255754111222'],
  ])('%p → %p', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it('maps every local format of one number to the same value (uniqueness)', () => {
    const forms = [
      '0712345678',
      '712345678',
      '255712345678',
      '+255712345678',
      '+255 712-345-678',
    ];
    expect(new Set(forms.map((f) => normalisePhone(f))).size).toBe(1);
  });

  it.each([
    '',
    'call me',
    '12345',
    '0712 345 67',
    '+1234567',
    '+1234567890123456',
    '0712x345678',
    '071234567890',
  ])('rejects %p', (raw) => {
    expect(normalisePhone(raw)).toBeNull();
  });
});
