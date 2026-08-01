import type { SourceConnector, SourceKind, RawSource } from "@/server/ingest/connector";

/**
 * Source-connector framework (W4). A connector says WHERE bytes come from (filesystem, an API,
 * a crawler); parsing (the format) is a separate registry. This catalog makes the plugin
 * architecture explicit: which connectors exist and whether each is available or a **framework
 * slot awaiting a plugin**. NO copyrighted or live-network fetch is built here — Wikipedia,
 * government-curriculum, academic-paper, api and crawler are declared slots only.
 *
 * A slot's connector refuses at the licence gate (`permitted:false`), so `acquire()` (licence-
 * before-fetch, §24) stops it before a single byte — the copyright defence at the front door.
 */
export interface ConnectorEntry {
  id: string;
  kinds: SourceKind[];
  status: "available" | "plugin-required";
  note: string;
}

const CATALOG = new Map<string, ConnectorEntry>();

export function registerConnector(entry: ConnectorEntry): void {
  CATALOG.set(entry.id, entry);
}
export function getConnector(id: string): ConnectorEntry | undefined {
  return CATALOG.get(id);
}
export function listConnectors(): ConnectorEntry[] {
  return [...CATALOG.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A framework-slot connector: declared, but no implementation. Its `license()` refuses (so
 * `acquire` never fetches), and `fetch()` throws with a "supply a plugin" message. This keeps the
 * engine complete + content-independent — a real Wikipedia/gov/academic connector is a plugin that
 * replaces this stub, never an engine change.
 */
export function pluginSlotConnector(id: string, kinds: SourceKind[]): SourceConnector {
  return {
    id,
    kinds,
    async license() {
      return { permitted: false, license: "unknown", requiresApproval: true, reason: `connector "${id}" is a framework slot — supply a plugin implementation (no copyrighted fetch is built in)` };
    },
    async fetch(): Promise<{ source: RawSource; bytes: Buffer }> {
      throw new Error(`connector "${id}" is not implemented — it is a framework slot; register a plugin`);
    },
  };
}

// ── seed the catalog ──
registerConnector({ id: "local-filesystem", kinds: ["book", "manual", "dataset"], status: "available", note: "reads files from disk; the operator asserts the licence (§24)" });
registerConnector({ id: "wikipedia", kinds: ["web"], status: "plugin-required", note: "framework slot — supply a plugin; no copyrighted/live fetch built" });
registerConnector({ id: "government-curriculum", kinds: ["web", "dataset"], status: "plugin-required", note: "framework slot — official curriculum documents; supply a plugin + assert licence" });
registerConnector({ id: "academic-paper", kinds: ["paper"], status: "plugin-required", note: "framework slot — research papers; supply a plugin + assert licence" });
registerConnector({ id: "api", kinds: ["dataset", "web"], status: "plugin-required", note: "framework slot — a structured API source; supply a plugin" });
registerConnector({ id: "crawler", kinds: ["web"], status: "plugin-required", note: "framework slot — a web crawler; supply a plugin + robots/licence policy" });
