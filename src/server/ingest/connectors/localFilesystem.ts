import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { LicenseInfo, RawSource, SourceConnector, SourceKind } from "@/server/ingest/connector";

/**
 * Local filesystem connector (§24, M1). Reads a source file from disk; the OPERATOR
 * asserts the licence — there is no automatic licence detection for local files, so the
 * asserted licence is what `license()` returns. `permitted` defaults to true (the
 * operator put the file there deliberately); pass `requiresApproval` for anything whose
 * reproduction rights are uncertain (e.g. an NCERT PDF: free download ≠ free reproduction).
 *
 * Produces raw bytes only — it never touches the graph (W3). Downstream extraction makes
 * MACHINE_PROPOSED knowledge like every other connector (§24).
 */
export interface LocalFsConfig {
  kind?: SourceKind;
  publisher?: string;
  authority?: string;
  /** The licence the operator asserts for files this connector reads. */
  license: string;
  licenseUrl?: string;
  requiresApproval?: boolean;
}

export function localFilesystemConnector(config: LocalFsConfig): SourceConnector {
  const license: LicenseInfo = {
    permitted: true,
    license: config.license,
    url: config.licenseUrl,
    requiresApproval: config.requiresApproval ?? false,
    reason: "operator asserts licence for local files",
  };
  return {
    id: "local-filesystem",
    kinds: [config.kind ?? "manual"],
    async license() {
      return license;
    },
    async fetch(ref: string) {
      const bytes = await readFile(ref);
      const source: RawSource = {
        kind: config.kind ?? "manual",
        title: basename(ref),
        publisher: config.publisher ?? "local",
        authority: config.authority ?? "operator",
        uri: `file://${ref}`,
        license: config.license,
        licenseUrl: config.licenseUrl,
      };
      return { source, bytes };
    },
  };
}
