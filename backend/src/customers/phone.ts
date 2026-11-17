/**
 * Phone normalisation for customers (S6). Output: "+" followed by 8–15
 * digits (E.164-style), the form stored and compared for uniqueness.
 *
 * Local numbers use the business country code (Tanzania, +255 — ADR-011's
 * business locale): "0712 345 678", "712345678", "255712345678" and
 * "+255 712-345-678" all become "+255712345678". Numbers written with "+" or
 * an international "00" prefix keep their own country code.
 */
export const DEFAULT_COUNTRY_CODE = '255';

const E164 = /^\+\d{8,15}$/;

export function normalisePhone(
  raw: string,
  countryCode = DEFAULT_COUNTRY_CODE,
): string | null {
  const trimmed = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null; // letters or other symbols
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  let result: string;
  if (plus) result = `+${digits}`;
  else if (digits.startsWith('00')) result = `+${digits.slice(2)}`;
  else if (
    digits.startsWith(countryCode) &&
    digits.length === countryCode.length + 9
  )
    result = `+${digits}`;
  else if (digits.startsWith('0') && digits.length === 10)
    result = `+${countryCode}${digits.slice(1)}`;
  // A bare 9-digit subscriber number never starts with 0 ("0712 345 67" is
  // a mistyped 10-digit local number, not a valid subscriber number).
  else if (digits.length === 9 && !digits.startsWith('0'))
    result = `+${countryCode}${digits}`;
  else return null;

  return E164.test(result) ? result : null;
}
