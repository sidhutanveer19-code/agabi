/**
 * Research connector architecture (§24). A connector fetches a source; `license()` runs
 * FIRST and can refuse ingestion — an unknown licence requires explicit human approval
 * before a single byte is fetched. This is the copyright defence at the front door.
 *
 * Binding invariant (§24): research NEVER writes the graph. Every connector produces raw
 * bytes into the identical pipeline; extraction downstream yields only MACHINE_PROPOSED
 * knowledge (M2). There is no privileged path and no trusted publisher — a connector
 * cannot weaken the trust guarantee, because promotion is a separate, gated process.
 */
export type SourceKind = "book" | "paper" | "web" | "dataset" | "manual";

export interface LicenseInfo {
  permitted: boolean; // false → do not fetch, ever
  license: string; // SPDX-ish id or free text
  url?: string;
  requiresApproval: boolean; // unknown/ambiguous licence → human approval before fetch
  reason?: string;
}

export interface RawSource {
  kind: SourceKind;
  title: string;
  publisher: string;
  authority: string;
  uri?: string;
  license: string;
  licenseUrl?: string;
}

export interface RateLimitPolicy {
  perMinute: number;
}

export interface SourceConnector {
  id: string;
  kinds: SourceKind[];
  /** Called BEFORE fetch. May refuse. */
  license(ref: string): Promise<LicenseInfo>;
  fetch(ref: string): Promise<{ source: RawSource; bytes: Buffer }>;
  rateLimit?: RateLimitPolicy;
}

/** A licence check refused the fetch — surfaced, never swallowed. */
export class LicenseRefused extends Error {
  constructor(
    public readonly connectorId: string,
    public readonly ref: string,
    public readonly info: LicenseInfo,
  ) {
    super(`connector ${connectorId} refused ${ref}: ${info.reason ?? info.license}`);
    this.name = "LicenseRefused";
  }
}

/**
 * The ONLY sanctioned way to pull a source: licence first, then fetch. A caller cannot
 * fetch past a refusal, and an unknown licence stops unless the operator explicitly
 * approves it (`approveUnknown`). This is where §24's "licence before fetch" is enforced
 * for every connector, so no individual connector has to remember to.
 */
export async function acquire(
  connector: SourceConnector,
  ref: string,
  opts: { approveUnknown?: boolean } = {},
): Promise<{ source: RawSource; bytes: Buffer }> {
  const info = await connector.license(ref);
  if (!info.permitted) throw new LicenseRefused(connector.id, ref, info);
  if (info.requiresApproval && !opts.approveUnknown) throw new LicenseRefused(connector.id, ref, info);
  return connector.fetch(ref);
}
