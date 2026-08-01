/**
 * Context dimension registry (§10 `ContextDimension`, §14.2). An OPEN registry —
 * adding a dimension is an INSERT, not a code change. `normaliseValue` is what makes
 * canonical hashing deterministic across value spellings (§14.2): the same jurisdiction
 * written "in" or "IN" must produce one context row, not two.
 */

export type DimensionValueType = "enum" | "iso3166" | "iso639" | "range" | "date" | "string";

export interface ContextDimension {
  key: string;
  valueType: DimensionValueType;
  values: string[];
  specificity: number;
  appliesTo: string[];
  since: string;
}

/** key → its registered definition. Empty on a fresh platform (§P7). */
export type DimensionRegistry = Record<string, ContextDimension>;

/**
 * Per-type normalisation (§14.2). ISO codes uppercase, dates to UTC midnight, enums
 * exact. Unknown/unregistered keys fall through to `string` so canonicalisation stays
 * pure and total even before the registry is populated — registration itself is
 * validated separately by V11, not here.
 */
export function normaliseValue(valueType: DimensionValueType, value: unknown): unknown {
  switch (valueType) {
    case "iso3166":
    case "iso639":
      return String(value).trim().toUpperCase();
    case "date": {
      const d = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(d.getTime())) return String(value); // don't fabricate a date
      // UTC midnight — a context is a day, not an instant.
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
    }
    case "range": {
      // {min,max} normalised to a stable two-tuple; anything else passes through as-is.
      if (value && typeof value === "object" && "min" in value && "max" in value) {
        const v = value as { min: unknown; max: unknown };
        return [v.min, v.max];
      }
      return value;
    }
    case "enum":
    case "string":
    default:
      return typeof value === "string" ? value.trim() : value;
  }
}
