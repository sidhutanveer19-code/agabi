import crypto from "node:crypto";
import { streamText, generateText, stepCountIs } from "ai";
import { getUserId } from "@/server/auth";
import { checkRateLimit } from "@/server/rateLimit";
import { teachBodySchema } from "@contract/schemas";
import { env } from "@/env";
import { providerChain, isFallthroughError, type ProviderEntry } from "@/server/ai/providers";
import { buildBatchTool } from "@/server/ai/blockTools";
import { coerceSlot, hasMeaningfulPayload } from "@/server/ai/coerce";
import { ollamaJSON, ollamaStream } from "@/server/ai/jsonFill";
import { buildSkeleton } from "@/server/ai/skeleton";
import { adaptBlock } from "@/server/ai/validateBlock";
import { regionTitle, batchPrompt, batchSystemPrompt, jsonSlotSystem, jsonSlotUser, textStreamSystem, textStreamUser, outlineSystemPrompt } from "@/server/ai/prompt";
import { defaultOutline, repairOutline, isText, type OutlineSlot } from "@/server/ai/outline";
import { emit, EVENTS } from "@/server/events";

// POST /api/teach — NDJSON stream of TeachEvents. Rate-limited [I3]; every block
// validated by the adapt ladder (never a blank hole [I1]); full event trail per
// lesson; provider fallback across free models (D2).
export const runtime = "nodejs";
export const maxDuration = 300; // Vercel Pro; Hobby is lower (D3 risk)

function jsonErr(code: string, message: string, status: number, recoverable: boolean) {
  return new Response(JSON.stringify({ code, message, recoverable }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request) {
  const userId = await getUserId(req);
  if (!userId) return jsonErr("unauthenticated", "Sign in first.", 401, false);

  const rl = checkRateLimit(`teach:${userId}`);
  if (!rl.ok) return jsonErr("rate_limited", "Too many lessons this minute — take a breath.", 429, true);

  const parsed = teachBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonErr("bad_request", "Invalid teach request.", 400, false);
  const { request } = parsed.data;

  const chain = providerChain();
  const sessionId = crypto.randomUUID();
  const encoder = new TextEncoder();
  const ac = new AbortController();

  const MAX_BLOCKS = 16; // hard ceiling — a runaway model can't burn free-tier tokens

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Every TeachEvent carries `v:1` (B2) — additive, the frozen frontend ignores it.
      const write = (ev: object) => controller.enqueue(encoder.encode(JSON.stringify({ v: 1, ...ev }) + "\n"));
      let blockCount = 0;
      let fallbackCount = 0;
      let capped = false;
      const fallbacks: string[] = [];

      const onBlock = async (type: string, data: Record<string, unknown>, streamText?: string) => {
        if (capped) return; // already at the ceiling — ignore further tool calls
        const a = adaptBlock(type, data, streamText);
        write({ t: "block", block: { type: a.type, data: a.data, streamText: a.streamText } });
        blockCount++;
        // Stop EMITTING past the ceiling, but let the model finish its step budget
        // naturally (stepCountIs) so usage/tokens still resolve — no abort here.
        if (blockCount >= MAX_BLOCKS) capped = true;
        if (a.fallback) {
          fallbackCount++;
          fallbacks.push(type);
          await emit(userId, EVENTS.blockFallback, { requested: type, reason: a.reason }, "server", sessionId);
        } else {
          await emit(userId, EVENTS.blockEmitted, { type: a.type }, "server", sessionId);
        }
      };

      await emit(userId, EVENTS.lessonStarted, { kind: request.kind, topic: request.topic }, "server", sessionId);
      write({ t: "status", status: "thinking" });

      if (chain.length === 0) {
        write({ t: "status", status: "error" });
        write({ t: "error", recoverable: true, message: "No model configured. Add a free key (GROQ_API_KEY or GOOGLE_API_KEY) to .env.local." });
        write({ t: "done" });
        await emit(userId, EVENTS.error, { message: "no_provider" }, "server", sessionId);
        controller.close();
        return;
      }

      const topic = request.topic?.trim() || "this idea";
      let served: string | null = null;
      let usedInput = 0;
      let usedOutput = 0;

      // ── PHASE 1 — plan the lesson INSTANTLY. No model call: defaultOutline is
      //    topic-shaped (pickVisualFor) and repairOutline enforces ≥3 visuals,
      //    heading-first, summary-last. One fewer model call, shape in <1s. ──
      const { outline, source } = repairOutline(defaultOutline(topic), topic);
      const N = outline.length;
      const uid = userId; // narrowed to string above; keep for nested closures
      const asText = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

      write({ t: "region", title: regionTitle(request) });
      write({ t: "status", status: "generating" });

      // ── PHASE 2 — SKELETON. Every block on screen immediately, in slot order,
      //    each a valid minimal payload (the RUNG-5 shapes). This IS the backfill,
      //    present from the start; a slot that never resolves keeps its shell. ──
      const skeleton = buildSkeleton(outline, topic);
      // Lock each slot's type to what actually rendered — coerce may downgrade a
      // hard visual (flow/map → mindmap); the fill rungs must target that same type.
      const eff: OutlineSlot[] = outline.map((s, i) => ({ ...s, type: skeleton[i].type }));
      const bySlot = new Map<number, OutlineSlot>(eff.map((s) => [s.slot, s]));
      await emit(uid, EVENTS.outlinePlanned, { source: "server", types: eff.map((s) => s.type) }, "server", sessionId);
      for (const b of skeleton) {
        await onBlock(b.type, b.data, b.streamText);
      }
      // patch.index === slot - 1 holds only if exactly one block emitted per slot.
      if (blockCount !== N) {
        await emit(uid, EVENTS.error, { message: "skeleton_count_mismatch", blockCount, expected: N }, "server", sessionId);
      }

      // ── PHASE 3 — FILL. Run the ladder (RUNG 1-4) and PATCH each slot as it
      //    resolves. Patches land in ANY order; blocks are already positioned by
      //    slot. Nothing blocks anything — no head-of-line deadline, no flush cursor. ──
      // telemetry (E). rung = HOW WELL (1 first-provider · 2 later mop-up · 3 same-
      // provider retry · 4 repaired · 5 skeleton), provider = WHO — kept SEPARATE.
      const rungCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const provRung: Record<string, Record<number, number>> = {};
      const blockTypeCounts: Record<string, number> = {};
      const patched = new Set<number>();
      let budgetExhaustedFlag = false;
      let firstPatchAt = 0;

      // A meaningful, coercible payload → patch DATA only (type locked at skeleton).
      // Empty / uncoercible → NOT authored; the shell stays, a later provider retries.
      function fillFromModel(n: number, data: Record<string, unknown>, text: string, p: ProviderEntry, later: boolean, retry: boolean, ms: number, tokens: number): boolean {
        if (patched.has(n)) return true;
        if (!hasMeaningfulPayload(text, data)) return false; // {} is not authored
        const s = bySlot.get(n);
        if (!s) return false;
        const c = coerceSlot(s.type, data, text, s.intent);
        if (c.status === "minimal") return false; // nothing usable — allow retry
        const rung = c.status === "repaired" ? 4 : later ? 2 : retry ? 3 : 1;
        patched.add(n);
        rungCount[rung]++;
        (provRung[p.name] ??= { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })[rung]++;
        blockTypeCounts[s.type] = (blockTypeCounts[s.type] ?? 0) + 1;
        const a = adaptBlock(s.type, c.data, isText(s.type) ? asText(c.data.text) : undefined);
        write({ t: "patch", index: n - 1, data: a.data });
        if (!firstPatchAt) firstPatchAt = Date.now();
        void emit(uid, EVENTS.slotFilled, { slot: n, provider: p.name, model: p.ollama?.modelId ?? p.name, slotType: s.type, rung, ok: true, ms, tokens }, "server", sessionId);
        return true;
      }

      const fillStart = Date.now();
      const budgetSpent = () => Date.now() - fillStart > 120_000; // total fill budget
      const withTimeout = (ms: number) => AbortSignal.any([ac.signal, AbortSignal.timeout(ms)]);

      // ── PROVIDER LADDER (B). Each provider fills the remaining slots via its
      //    capability path (tools → batch; json → per-slot native Ollama). ──
      for (let pi = 0; pi < chain.length; pi++) {
        if (ac.signal.aborted || budgetSpent()) break;
        const p = chain[pi];
        const later = pi > 0;
        const remaining = eff.filter((s) => !patched.has(s.slot));
        if (remaining.length === 0) break;

        if (p.caps.supportsTools) {
          // TOOL PATH — one batch stream, N tool calls (per-slot tokens not itemised).
          const batch = buildBatchTool(remaining, async (n, data, text) => {
            fillFromModel(n, data, text, p, later, false, 0, 0);
          });
          try {
            const res = streamText({
              model: p.model,
              system: batchSystemPrompt(),
              prompt: batchPrompt(topic, remaining),
              tools: batch.tools,
              toolChoice: "required",
              stopWhen: stepCountIs(remaining.length + 4),
              temperature: 0.7,
              maxRetries: 1,
              abortSignal: withTimeout(90_000),
            });
            await res.consumeStream();
            const u = await res.usage;
            served = served ?? p.name;
            usedInput += u.inputTokens ?? 0;
            usedOutput += u.outputTokens ?? 0;
          } catch (err) {
            if (ac.signal.aborted) break;
            await emit(uid, isFallthroughError(err) ? EVENTS.providerRatelimited : EVENTS.error, { provider: p.name, phase: "batch", message: String((err as Error).message) }, "server", sessionId);
          }
        } else if (p.ollama) {
          // JSON / TEXT-STREAM PATH — per slot, sequential (Ollama concurrency dead).
          const oll = p.ollama;
          for (const s of remaining) {
            if (ac.signal.aborted || budgetSpent()) break;
            if (patched.has(s.slot)) continue;
            served = served ?? p.name;

            const attempt = async (retry: boolean): Promise<boolean> => {
              try {
                if (isText(s.type)) {
                  // TEXT: stream prose word-by-word (I). Interim patches update the
                  // live block; the final fillFromModel marks it authored.
                  let lastWords = 0, lastAt = 0;
                  const r = await ollamaStream(oll.nativeBase, oll.modelId, textStreamSystem(), textStreamUser(topic, s), withTimeout(30_000), (full) => {
                    const words = full.split(/\s+/).length;
                    const now = Date.now();
                    if (words - lastWords >= 3 || now - lastAt >= 200) {
                      lastWords = words; lastAt = now;
                      const a = adaptBlock(s.type, { text: full }, full);
                      write({ t: "patch", index: s.slot - 1, data: a.data });
                      if (!firstPatchAt) firstPatchAt = Date.now();
                    }
                  });
                  usedOutput += r.tokens;
                  return fillFromModel(s.slot, { text: r.text }, r.text, p, later, retry, r.ms, r.tokens);
                }
                // VISUAL: one JSON request per slot (native /api/chat, format:json).
                const r = await ollamaJSON(oll.nativeBase, oll.modelId, jsonSlotSystem(), jsonSlotUser(topic, s), withTimeout(30_000));
                usedOutput += r.tokens;
                return fillFromModel(s.slot, r.data, r.parsed ? "" : r.raw, p, later, retry, r.ms, r.tokens);
              } catch {
                return false;
              }
            };

            let ok = await attempt(false);
            if (!ok && !ac.signal.aborted && !budgetSpent()) ok = await attempt(true); // one same-provider retry → rung 3
          }
        }
      }

      const unresolved = N - patched.size;
      rungCount[5] = unresolved; // slots that kept their skeleton (no model content)
      if (budgetSpent() && unresolved > 0) {
        budgetExhaustedFlag = true;
        await emit(uid, EVENTS.fillBudgetExhausted, { resolved: patched.size, unresolved }, "server", sessionId);
      }

      // Shadow planning (E) — 1 in 10, LOCAL ONLY (bare fire-and-forget is killed on
      // serverless once the stream closes → silent-null). Logs the model's proposed
      // outline vs the rules' — NEVER used. Awaited so it records before close.
      if (env.NODE_ENV !== "production" && chain.length > 0 && Math.random() < 0.1) {
        try {
          const r = await generateText({ model: chain[0].model, system: outlineSystemPrompt(), prompt: topic, maxRetries: 0, abortSignal: withTimeout(20_000) });
          const m = r.text.match(/\[[\s\S]*\]/);
          const proposed = m ? JSON.parse(m[0]) : null;
          await emit(uid, EVENTS.shadowPlan, { proposed, chosen: eff.map((s) => s.type) }, "server", sessionId);
        } catch { /* never affects the lesson */ }
      }

      const authored = rungCount[1] + rungCount[2] + rungCount[3] + rungCount[4];
      const authorRate = N ? authored / N : 0;
      const genSecs = (Date.now() - fillStart) / 1000;
      const tokPerSec = genSecs > 0 ? Math.round(usedOutput / genSecs) : 0;

      // Client interrupt ends without a summary.
      if (ac.signal.aborted) {
        await emit(userId, EVENTS.lessonCancelled, { served, blockCount }, "server", sessionId);
        try { controller.close(); } catch { /* already closed */ }
        return;
      }

      if (blockCount === 0) {
        write({ t: "status", status: "error" });
        write({ t: "error", recoverable: true, message: "The teacher is busy right now. Try again in a moment." });
        write({ t: "done" });
        await emit(userId, EVENTS.error, { message: "no_blocks_generated" }, "server", sessionId);
        controller.close();
        return;
      }

      // Non-contract usage line — the frontend safely drops it (unknown `t`), but
      // instruments/harnesses can read real token cost per lesson.
      write({ t: "usage", provider: served, inputTokens: usedInput, outputTokens: usedOutput, tokPerSec, blockCount, fallbackCount, fallbacks, repairs: rungCount[4], slots: N, outlineSource: source, authorRate, rungCount, provRung, unresolved, blockTypeCounts, budgetExhausted: budgetExhaustedFlag, finalTypes: eff.map((s) => s.type) });
      write({ t: "status", status: "finished" });
      write({ t: "done" });
      await emit(userId, EVENTS.lessonFinished, { served, blockCount, authorRate, tokPerSec, unresolved, inputTokens: usedInput, outputTokens: usedOutput, blockTypeCounts }, "server", sessionId);
      controller.close();
    },
    cancel() {
      ac.abort(); // client interrupted mid-stream (V1)
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache, no-transform" },
  });
}
