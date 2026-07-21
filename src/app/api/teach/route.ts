import crypto from "node:crypto";
import { streamText, generateObject, generateText, stepCountIs } from "ai";
import { z } from "zod";
import { getUserId } from "@/server/auth";
import { checkRateLimit } from "@/server/rateLimit";
import { teachBodySchema } from "@contract/schemas";
import { providerChain, isFallthroughError, ollamaEntry } from "@/server/ai/providers";
import { buildSlotTool } from "@/server/ai/slotTools";
import { buildBatchTool } from "@/server/ai/blockTools";
import { coerceSlot } from "@/server/ai/coerce";
import { OrderedFiller } from "@/server/ai/fill";
import { adaptBlock } from "@/server/ai/validateBlock";
import { regionTitle, outlineSystemPrompt, slotPrompt, slotShapePrompt, batchPrompt, batchSystemPrompt } from "@/server/ai/prompt";
import { defaultOutline, repairOutline, isText, FALLBACK_VISUAL, type OutlineSlot } from "@/server/ai/outline";
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

      // ── PHASE 1 — outline. First working provider; ANY failure → defaultOutline. ──
      const outlineSchema = z.object({
        slots: z.array(z.object({ slot: z.number(), type: z.string(), intent: z.string() })),
      });
      write({ t: "status", status: "planning" });
      let rawSlots: OutlineSlot[] = [];
      let rung: "generateObject" | "json" | "default" = "default";

      // Rung 1 — structured output (the clean path).
      for (const p of chain) {
        if (ac.signal.aborted) break;
        try {
          const r = await generateObject({
            model: p.model,
            schema: outlineSchema,
            system: outlineSystemPrompt(),
            prompt: topic,
            maxRetries: 1,
            abortSignal: ac.signal,
          });
          rawSlots = r.object.slots as OutlineSlot[];
          served = p.name;
          usedInput += r.usage.inputTokens ?? 0;
          usedOutput += r.usage.outputTokens ?? 0;
          rung = "generateObject";
          break;
        } catch (err) {
          if (ac.signal.aborted) break;
          const key = isFallthroughError(err) ? EVENTS.providerRatelimited : EVENTS.error;
          await emit(userId, key, { provider: p.name, phase: "outline", message: String((err as Error).message) }, "server", sessionId);
          continue;
        }
      }

      // Rung 2 — free models often can emit JSON, just not through the structured
      // API. Ask for raw text, then JSON.parse the first [...] found.
      if (rawSlots.length === 0 && !ac.signal.aborted) {
        for (const p of chain) {
          if (ac.signal.aborted) break;
          try {
            const r = await generateText({
              model: p.model,
              system: `${outlineSystemPrompt()}\nRespond with ONLY the raw JSON array. No markdown, no code fences.`,
              prompt: topic,
              maxRetries: 1,
              abortSignal: ac.signal,
            });
            usedInput += r.usage.inputTokens ?? 0;
            usedOutput += r.usage.outputTokens ?? 0;
            const match = r.text.match(/\[[\s\S]*\]/);
            const parsed = match ? JSON.parse(match[0]) : null;
            if (Array.isArray(parsed) && parsed.length > 0) {
              rawSlots = parsed as OutlineSlot[];
              served = served ?? p.name;
              rung = "json";
              break;
            }
          } catch (err) {
            if (ac.signal.aborted) break;
            await emit(userId, EVENTS.error, { provider: p.name, phase: "outline-json", message: String((err as Error).message) }, "server", sessionId);
            continue;
          }
        }
      }

      // Rung 3 — known-good default (topic-varied). Never fatal.
      if (rawSlots.length === 0) {
        rawSlots = defaultOutline(topic);
        rung = "default";
      }
      await emit(userId, EVENTS.outlineFallback, { rung }, "server", sessionId);

      // ── PHASE 2 — repair (pure code, no model). THE GUARANTEE. ──
      const { outline, changes, source } = repairOutline(rawSlots, topic);
      await emit(userId, EVENTS.outlineRepaired, { changes, finalTypes: outline.map((s) => s.type), source }, "server", sessionId);

      write({ t: "region", title: regionTitle(request) });
      write({ t: "status", status: "generating" });

      // ── PHASE 3 — the 5-rung fill ladder. Every slot resolves; empty backfill is
      //    now the last resort (RUNG 5), never the first. Blocks stream incrementally
      //    IN ORDER via a cursor — no blank-canvas-then-dump. ──
      const N = outline.length;
      const bySlot = new Map<number, OutlineSlot>(outline.map((s) => [s.slot, s]));
      type Raw = { type: string; data: Record<string, unknown>; text: string; rung: 1 | 2 | 3 | 5; downgraded?: boolean };
      const raw = new Map<number, Raw>();
      const rungCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let downgradedCount = 0;
      let headOfLineCount = 0;
      let budgetExhaustedFlag = false;
      let nextToEmitSince = Date.now();
      const uid = userId; // narrowed to string above; keep it for nested closures
      const asText = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

      // The ordering cursor (heading-first / summary-last). onAdvance resets the
      // head-of-line clock each time a slot flushes.
      const filler = new OrderedFiller(
        (b) => onBlock(b.type, b.data, b.streamText),
        () => { nextToEmitSince = Date.now(); },
      );

      // Coerce a slot's raw payload (RUNG 4 repair, else RUNG 5 minimal visual) and
      // queue it in order. Terminal rung: minimal→5, repaired→4, else the source rung.
      async function resolveSlot(n: number) {
        if (filler.settled(n)) return;
        const s = bySlot.get(n);
        if (!s) return;
        const r = raw.get(n);
        const useType = r?.type ?? s.type;
        const c = coerceSlot(useType, r?.data ?? {}, r?.text ?? "", s.intent);
        const rung = c.status === "minimal" ? 5 : c.status === "repaired" ? 4 : (r?.rung ?? 5);
        rungCount[rung]++;
        if (r?.downgraded) downgradedCount++;
        void emit(uid, EVENTS.slotFilled, { slot: n, type: c.type, rung, downgraded: r?.downgraded ?? false }, "server", sessionId);
        await filler.place(n, { type: c.type, data: c.data, streamText: isText(c.type) ? asText(c.data.text) : undefined });
      }

      async function record(n: number, type: string, data: Record<string, unknown>, text: string, rung: 1 | 2 | 3, downgraded?: boolean) {
        if (raw.has(n) || filler.settled(n)) return; // first meaningful content for a slot wins
        raw.set(n, { type, data, text, rung, downgraded });
        await resolveSlot(n);
      }

      const fillStart = Date.now();
      const budgetSpent = () => Date.now() - fillStart > 120_000; // total ladder budget
      const withTimeout = (ms: number) => AbortSignal.any([ac.signal, AbortSignal.timeout(ms)]);

      // RUNG 1 — one batch call fills all slots (shared context = ~5× fewer tokens).
      const batch = buildBatchTool(outline, async (n, data, text) => {
        await record(n, (bySlot.get(n) ?? outline[0]).type, data, text, 1);
      });
      for (const p of chain) {
        if (ac.signal.aborted) break;
        try {
          const res = streamText({
            model: p.model,
            system: batchSystemPrompt(),
            prompt: batchPrompt(topic, outline),
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
          await emit(userId, isFallthroughError(err) ? EVENTS.providerRatelimited : EVENTS.error, { provider: p.name, phase: "batch", message: String((err as Error).message) }, "server", sessionId);
          continue;
        }
      }

      // Head-of-line watchdog — clock starts NOW (after RUNG 1, not lesson start;
      // during RUNG 1 tool calls stream in at any time). If the queue head sits
      // unresolved > 20s, force it to RUNG 5 so the rest can flush.
      nextToEmitSince = Date.now();
      let watchdogStop = false;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const watchdog = (async () => {
        while (!watchdogStop && filler.next <= N && !ac.signal.aborted) {
          await sleep(2_000);
          if (watchdogStop || ac.signal.aborted) break;
          const n = filler.next;
          if (n <= N && !filler.settled(n) && Date.now() - nextToEmitSince >= 20_000) {
            const s = bySlot.get(n)!;
            const waitedMs = Date.now() - nextToEmitSince;
            raw.set(n, { type: s.type, data: {}, text: "", rung: 5 });
            headOfLineCount++;
            await emit(uid, EVENTS.headOfLineForced, { slot: n, type: s.type, waitedMs }, "server", sessionId);
            await resolveSlot(n);
          }
        }
      })();

      // RUNG 2 — focused single-slot retry on the chain, for slots RUNG 1 missed.
      for (const s of outline) {
        if (ac.signal.aborted || budgetSpent()) break;
        if (raw.has(s.slot) || filler.settled(s.slot)) continue;
        const priorIntents = outline.filter((x) => x.slot < s.slot).map((x) => x.intent);
        const slot = buildSlotTool(s.type, async (_t, data, stext) => {
          await record(s.slot, s.type, data, stext ?? "", 2);
        });
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
            if (slot.didEmit()) break;
          } catch {
            if (ac.signal.aborted) break;
            continue;
          }
        }
      }

      // RUNG 3 — retry on local Ollama, up to 3× WITH VARIATION (not repetition):
      // 1 = full prompt, 2 = shape only, 3 = substitute an easier type (mindmap).
      const ollama = ollamaEntry();
      if (ollama) {
        for (const s of outline) {
          if (ac.signal.aborted || budgetSpent()) break;
          if (raw.has(s.slot) || filler.settled(s.slot)) continue;
          for (let attempt = 1; attempt <= 3; attempt++) {
            if (raw.has(s.slot) || filler.settled(s.slot) || ac.signal.aborted || budgetSpent()) break;
            let useType = s.type;
            let downgraded = false;
            let prompt: string;
            if (attempt === 1) prompt = slotPrompt(topic, s, []);
            else if (attempt === 2) prompt = slotShapePrompt(s);
            else {
              useType = FALLBACK_VISUAL;
              downgraded = true;
              prompt = slotShapePrompt({ type: FALLBACK_VISUAL, intent: s.intent });
            }
            const slot = buildSlotTool(useType, async (_t, data, stext) => {
              await record(s.slot, useType, data, stext ?? "", 3, downgraded);
            });
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

      // Final sweep — any slot still unresolved goes straight to RUNG 5. A slow
      // lesson must still be a COMPLETE lesson.
      const remainingBeforeSweep = outline.filter((s) => !filler.settled(s.slot)).length;
      if (budgetSpent() && remainingBeforeSweep > 0) budgetExhaustedFlag = true;
      for (const s of outline) {
        if (ac.signal.aborted) break;
        if (filler.settled(s.slot)) continue;
        if (!raw.has(s.slot)) raw.set(s.slot, { type: s.type, data: {}, text: "", rung: 5 });
        await resolveSlot(s.slot);
      }
      watchdogStop = true;
      await watchdog;
      if (budgetExhaustedFlag) {
        await emit(userId, EVENTS.fillBudgetExhausted, { resolvedSlots: filler.emitted, remaining: remainingBeforeSweep }, "server", sessionId);
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
      write({ t: "usage", provider: served, inputTokens: usedInput, outputTokens: usedOutput, blockCount, fallbackCount, fallbacks, repairs: changes.length, slots: N, outlineSource: source, rung, authorRate, rungCount, downgraded: downgradedCount, headOfLineForced: headOfLineCount, budgetExhausted: budgetExhaustedFlag, finalTypes: outline.map((s) => s.type) });
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
