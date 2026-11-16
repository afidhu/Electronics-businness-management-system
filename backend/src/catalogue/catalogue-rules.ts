/**
 * Pure catalogue rules (ADR-025). No I/O, so they are reused by DTOs,
 * services, the demo seed and (for identifiers) Module 5 receiving.
 */

// ---------------------------------------------------------------- SKU -----

/** 2–40 chars, A–Z 0–9 . _ -, starting with a letter or digit (DB CHECK mirrors this). */
export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;

/** Trim and upper-case. Case-insensitive uniqueness follows from storing this form. */
export function normaliseSku(raw: string): string {
  return raw.trim().toUpperCase();
}

// ------------------------------------------------------------ names -----

/** Display form: trimmed, internal whitespace collapsed. */
export function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Uniqueness key for category/brand names: case-insensitive. */
export function nameKey(raw: string): string {
  return cleanName(raw).toLowerCase();
}

// --------------------------------------------------- specifications -----

export const SPEC_MAX_ENTRIES = 30;
export const SPEC_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _]{0,39}$/;
export const SPEC_MAX_STRING = 200;

export type Specifications = Record<string, string | number | boolean>;

/** Returns problems (empty when valid). Flat object of string/number/boolean. */
export function specificationProblems(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return ['specifications must be an object of key/value pairs'];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const problems: string[] = [];
  if (entries.length > SPEC_MAX_ENTRIES) {
    problems.push(
      `specifications may have at most ${SPEC_MAX_ENTRIES} entries`,
    );
  }
  for (const [key, v] of entries) {
    if (!SPEC_KEY_PATTERN.test(key)) {
      problems.push(
        `specification key "${key.slice(0, 40)}" is invalid (1-40 letters, digits, spaces, _)`,
      );
    }
    const ok =
      (typeof v === 'string' && v.length <= SPEC_MAX_STRING) ||
      (typeof v === 'number' && Number.isFinite(v)) ||
      typeof v === 'boolean';
    if (!ok) {
      problems.push(
        `specification "${key.slice(0, 40)}" must be text (max ${SPEC_MAX_STRING}), a number or true/false`,
      );
    }
  }
  return problems;
}

/** Trim string values (keys are kept as given). */
export function normaliseSpecifications(spec: Specifications): Specifications {
  return Object.fromEntries(
    Object.entries(spec).map(([k, v]) => [
      k.trim(),
      typeof v === 'string' ? v.trim() : v,
    ]),
  );
}

// ------------------------------------------- serialized identifiers -----
// Used by Module 5 when receiving units; defined here with the product policy.

export type IdentifierKind = 'IMEI' | 'SERIAL';

export const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9./-]{3,63}$/;

/** Luhn checksum used by the 15th IMEI digit. */
export function isValidImei(imei: string): boolean {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(imei[14 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Normalise an identifier for storage and uniqueness (D3: unique across the
 * organisation AFTER normalisation). IMEIs keep digits only ("35-209900 176148 1"
 * → "352099001761481"); serials are trimmed and upper-cased.
 */
export function normaliseIdentifier(kind: IdentifierKind, raw: string): string {
  return kind === 'IMEI' ? raw.replace(/[\s-]/g, '') : raw.trim().toUpperCase();
}

/** Returns a problem message, or null when the normalised identifier is valid. */
export function identifierProblem(
  kind: IdentifierKind,
  normalised: string,
): string | null {
  if (kind === 'IMEI') {
    return isValidImei(normalised)
      ? null
      : 'IMEI must be 15 digits with a valid check digit';
  }
  return SERIAL_PATTERN.test(normalised)
    ? null
    : 'serial must be 4-64 characters: A-Z, 0-9, ".", "/", "-"';
}

// -------------------------------------------------------------- prices -----

export const PRICE_FIELDS = ['costPrice', 'sellingPrice'] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];

/** Fields that can never change after creation (D9). */
export const IMMUTABLE_PRODUCT_FIELDS = [
  'sku',
  'trackingMode',
  'identifierType',
  'identifiersPerUnit',
] as const;
