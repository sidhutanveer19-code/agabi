import crypto from "node:crypto";
import { streamText, stepCountIs } from "ai";
import { getUserId } from "@/server/auth";
import { checkRateLimit } from "@/server/rateLimit";
import { teachBodySchema } from "@contract/schemas";
import { providerChain, isFallthroughError, ollamaEntry } from "@/server/ai/providers";
import { buildSlotTool } from "@/server/ai/slotTools";
import { buildBatchTool } from "@/server/ai/blockTools";
import { coerceSlot } from "@/server/ai/coerce";
import { buildSkeleton } from "@/server/ai/skeleton";
import { adaptBlock } from "@/server/ai/validateBlock";
import { regionTitle, slotPrompt, slotShapePrompt, batchPrompt, batchSystemPrompt } from "@/server/ai/prompt";
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
      const write = (ev: unknown) => controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
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
      const { outline, changes, source } = repairOutline(defaultOutline(topic), topic);
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
      const rungCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
      const patched = new Set<number>();
      let budgetExhaustedFlag = false;

      // A meaningful payload → coerce (repair = RUNG 4) → patch DATA only (type is
      // locked at skeleton). An unusable payload (coerce → minimal) is ignored, so
      // the shell stays and a later rung may still fill it.
      function fill(n: number, data: Record<string, unknown>, text: string, srcRung: 1 | 2 | 3) {
        if (patched.has(n)) return;
        const s = bySlot.get(n);
        if (!s) return;
        const c = coerceSlot(s.type, data, text, s.intent);
        if (c.status === "minimal") return; // nothing usable — keep the shell, allow retry
        const rung = c.status === "repaired" ? 4 : srcRung;
        patched.add(n);
        rungCount[rung]++;
        const a = adaptBlock(s.type, c.data, isText(s.type) ? asText(c.data.text) : undefined);
        write({ t: "patch", index: n - 1, data: a.data });
        void emit(uid, EVENTS.slotFilled, { slot: n, type: s.type, rung }, "server", sessionId);
      }

      const fillStart = Date.now();
      const budgetSpent = () => Date.now() - fillStart > 120_000; // total fill budget
      const withTimeout = (ms: number) => AbortSignal.any([ac.signal, AbortSignal.timeout(ms)]);

      // RUNG 1 — one batch call fills all slots (shared context = ~5× fewer tokens).
      const batch = buildBatchTool(eff, async (n, data, text) => { fill(n, data, text, 1); });
      for (const p of chain) {
        if (ac.signal.aborted) break;
        try {
          const res = streamText({
            model: p.model,
            system: batchSystemPrompt(),
            prompt: batchPrompt(topic, eff),
            tools: batch.tools,
            toolChoice: "required",
            stopWhen: stepCountIs(N + 4),
            temperature: 0.7,
            maxRetries: 1,
            abortSignal: withTimeout(90_000),
          });
          await res.consumeStream();
          const u = await res.usage;
          served = served ?? p.name;
          usedInput += u.inputTokens ?? 0;
          usedOutput += u.outputTokens ?? 0;
          break;
        } catch (err) {
          if (ac.signal.aborted) break;
          await emit(uid, isFallthroughError(err) ? EVENTS.providerRatelimited : EVENTS.error, { provider: p.name, phase: "batch", message: String((err as Error).message) }, "server", sessionId);
          continue;
        }
      }

      // RUNG 2 — focused single-slot retry on the chain, FULL 30s timeout (nothing
      // pre-empts it now — the whole reason the head-of-line deadline is gone).
      for (const s of eff) {
        if (ac.signal.aborted || budgetSpent()) break;
        if (patched.has(s.slot)) continue;
        const priorIntents = eff.filter((x) => x.slot < s.slot).map((x) => x.intent);
        const slot = buildSlotTool(s.type, async (_t, data, stext) => { fill(s.slot, data, stext ?? "", 2); });
        for (const p of chain) {
          if (ac.signal.aborted) break;
          try {
            await streamText({
              model: p.model,
              system: "You fill exactly one block. Call your only tool once, then stop.",
              prompt: slotPrompt(topic, s, priorIntents),
              tools: slot.tools,
              toolChoice: "required",
              stopWhen: stepCountIs(3),
              temperature: 0.7,
              maxRetries: 1,
              abortSignal: withTimeout(30_000),
            }).consumeStream();
            if (patched.has(s.slot)) break;
          } catch {
            if (ac.signal.aborted) break;
            continue;
          }
        }
      }

      // RUNG 3 — local Ollama, up to 3× WITH VARIATION (same type — the skeleton
      // locks it): attempt 1 full prompt, attempts 2-3 shape-only. Full 30s each.
      const ollama = ollamaEntry();
      if (ollama) {
        for (const s of eff) {
          if (ac.signal.aborted || budgetSpent()) break;
          if (patched.has(s.slot)) continue;
          for (let attempt = 1; attempt <= 3; attempt++) {
            if (patched.has(s.slot) || ac.signal.aborted || budgetSpent()) break;
            const prompt = attempt === 1 ? slotPrompt(topic, s, []) : slotShapePrompt(s);
            const slot = buildSlotTool(s.type, async (_t, data, stext) => { fill(s.slot, data, stext ?? "", 3); });
            try {
              await streamText({
                model: ollama.model,
                system: "You fill exactly one block. Call your only tool once, then stop.",
                prompt,
                tools: slot.tools,
                toolChoice: "required",
                stopWhen: stepCountIs(3),
                temperature: 0.6,
                maxRetries: 0,
                abortSignal: withTimeout(30_000),
              }).consumeStream();
            } catch {
              if (ac.signal.aborted) break;
            }
          }
        }
      }

      const unresolved = N - patched.size;
      if (budgetSpent() && unresolved > 0) {
        budgetExhaustedFlag = true;
        await emit(uid, EVENTS.fillBudgetExhausted, { resolved: patched.size, unresolved }, "server", sessionId);
      }
      const authored = rungCount[1] + rungCount[2] + rungCount[3] + rungCount[4];
      const authorRate = N ? authored / N : 0;

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
      write({ t: "usage", provider: served, inputTokens: usedInput, outputTokens: usedOutput, blockCount, fallbackCount, fallbacks, repairs: changes.length, slots: N, outlineSource: source, authorRate, rungCount, unresolved, budgetExhausted: budgetExhaustedFlag, finalTypes: eff.map((s) => s.type) });
      write({ t: "status", status: "finished" });
      write({ t: "done" });
      await emit(userId, EVENTS.lessonFinished, { served, blockCount, fallbackCount, inputTokens: usedInput, outputTokens: usedOutput }, "server", sessionId);
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
