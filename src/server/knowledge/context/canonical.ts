import { sha256 } from "@/server/knowledge/ids";
import { normaliseValue, type DimensionRegistry, type DimensionValueType } from "@/server/knowledge/context/registry";

/**
 * Context canonical hashing (§14.2, C5). A Context's identity IS its content: two
 * identical dimension sets MUST hash to one row, or specificity matching silently
 * fragments. This is the `context-canonical` standing invariant (§29).
 *
 *   canonical(dims) = JSON.stringify(
 *     Object.keys(dims).sort().map(k => [k, normaliseValue(registry[k].valueType, dims[k])]));
 *   contextId = sha256(canonical(dims));
 *
 * Key order is sorted so `{a,b}` and `{b,a}` canonicalise identically. Values are
 * normalised per registered type; an unregistered key normalises as `string` so the
 * function is total on a fresh platform (registration is enforced by V11, not here).
 */
export function canonicalize(
  dimensions: Record<string, unknown>,
  registry: DimensionRegistry = {},
): string {
  const entries = Object.keys(dimensions)
    .sort()
    .map((k) => {
      const valueType: DimensionValueType = registry[k]?.valueType ?? "string";
      return [k, normaliseValue(valueType, dimensions[k])];
    });
  return JSON.stringify(entries);
}

export function contextId(
  dimensions: Record<string, unknown>,
  registry: DimensionRegistry = {},
): string {
  return sha256(canonicalize(dimensions, registry));
}
