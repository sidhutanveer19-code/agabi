import { type TrustLevel, type TrustPolicy, type Labelled, trustRank } from "@/server/knowledge/types";

/**
 * TrustPolicy application (§26.4). A content read admits a row three ways:
 *   · trust < refuseBelow  → REFUSE (dropped entirely)
 *   · trust < labelBelow   → LABEL  (returned, but carries `labelled: true` — never bare)
 *   · otherwise            → PLAIN
 *
 * The invariant no policy may relax: the platform never silently presents uncertain
 * knowledge as fact. `no-silent-uncertainty` (§29) is exactly this — nothing below
 * `labelBelow` is ever returned unlabelled. (Promotion/demotion and DISPUTED suspension
 * are M2/M6; this file is only the read-time gate.)
 */
export type Admission = "refuse" | "label" | "plain";

export function admit(level: TrustLevel, policy: TrustPolicy): Admission {
  const r = trustRank(level);
  if (r < trustRank(policy.refuseBelow)) return "refuse";
  if (r < trustRank(policy.labelBelow)) return "label";
  return "plain";
}

/** Filter + label a set of content rows under a policy. Refused rows never appear. */
export function applyPolicy<T extends { trustLevel: TrustLevel }>(rows: T[], policy: TrustPolicy): Labelled<T>[] {
  const out: Labelled<T>[] = [];
  for (const row of rows) {
    const a = admit(row.trustLevel, policy);
    if (a === "refuse") continue;
    out.push({ ...row, labelled: a === "label" });
  }
  return out;
}

/**
 * Standard admission policies (§26.4). Each names its floor; nothing below `labelBelow`
 * is served bare. Callers pass one explicitly — there is no default (ADR-6).
 */
export const POLICIES = {
  EXAM_PREP: policy("OFFICIAL_SOURCE_VERIFIED"),
  CLINICAL: policy("EXPERT_REVIEWED"),
  GENERAL_SCHOOL: policy("COMMUNITY_REVIEWED"),
  RESEARCH: policy("AUTO_VALIDATED"),
  RND: policy("MACHINE_PROPOSED"),
} as const satisfies Record<string, TrustPolicy>;

/** A policy whose floor, label-threshold and refuse-threshold are all `minimum`. */
function policy(minimum: TrustLevel): TrustPolicy {
  return { minimum, labelBelow: minimum, refuseBelow: minimum };
}
