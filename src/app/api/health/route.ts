import { checkAll, aggregate } from "@/server/health";
import { providerChain } from "@/server/advisors/providers";

// GET /api/health — the full subsystem report. Shallow by default; ?deep=1 runs live
// checks. This route lives in src/app (outside architecture.test's src/server walk), so
// it may import providerChain() to inject the one live signal the walled health providers
// deliberately can't see: whether the model chain is empty.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const components = await checkAll({ deep });
  const providerNames = providerChain().map((p) => p.name);
  const overall = aggregate(components, { emptyProviderChain: providerNames.length === 0 });

  const httpOk = overall.status === "UP" || overall.status === "DEGRADED" || overall.status === "INSUFFICIENT_DATA";
  return new Response(
    JSON.stringify({ status: overall.status, reason: overall.reason, providers: providerNames, components, ts: Date.now() }, null, deep ? 2 : 0),
    { status: httpOk ? 200 : 503, headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
