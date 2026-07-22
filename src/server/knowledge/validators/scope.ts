import { isPublic, type Scope } from "@/server/knowledge/types";
import { pass, type ValidationResult } from "@/server/knowledge/validators/types";

/**
 * V13 — tenant scope (§14, §23). A tenant proposal may reference public concepts (one-way)
 * but NEVER another tenant's; a public proposal may reference no tenant at all. A violation
 * is not a validation nit — it is a `securityAlert`, because a cross-tenant reference is
 * how one tenant's data leaks into another's graph.
 */
export function v13Scope(proposalScope: Scope, referencedScopes: Scope[]): ValidationResult {
  for (const ref of referencedScopes) {
    if (isPublic(ref)) continue; // referencing public is always allowed
    if (isPublic(proposalScope)) {
      return { validator: "V13", outcome: "discard", reason: "PUBLIC_REFERENCES_TENANT", securityAlert: true, detail: ref };
    }
    if (ref !== proposalScope) {
      return { validator: "V13", outcome: "discard", reason: "CROSS_TENANT_REFERENCE", securityAlert: true, detail: ref };
    }
  }
  return pass("V13");
}
