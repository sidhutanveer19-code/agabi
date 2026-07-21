import crypto from "node:crypto";
import { streamText, generateObject, stepCountIs } from "ai";
import { z } from "zod";
import { getUserId } from "@/server/auth";
import { checkRateLimit } from "@/server/rateLimit";
import { teachBodySchema } from "@contract/schemas";
import { providerChain, isFallthroughError } from "@/server/ai/providers";
import { buildSlotTool } from "@/server/ai/slotTools";
import { adaptBlock } from "@/server/ai/validateBlock";
import { regionTitle, outlineSystemPrompt, slotPrompt } from "@/server/ai/prompt";
import { defaultOutline, repairOutline, type OutlineSlot } from "@/server/ai/outline";
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
          break;
        } catch (err) {
          if (ac.signal.aborted) break;
          const key = isFallthroughError(err) ? EVENTS.providerRatelimited : EVENTS.error;
          await emit(userId, key, { provider: p.name, phase: "outline", message: String((err as Error).message) }, "server", sessionId);
          continue;
        }
      }
      if (rawSlots.length === 0) rawSlots = defaultOutline(topic); // model outline failed → known-good

      // ── PHASE 2 — repair (pure code, no model). THE GUARANTEE. ──
      const { outline, changes } = repairOutline(rawSlots, topic);
      await emit(userId, EVENTS.outlineRepaired, { changes, finalTypes: outline.map((s) => s.type) }, "server", sessionId);

      write({ t: "region", title: regionTitle(request) });
      write({ t: "status", status: "generating" });

      // ── PHASE 3 — fill each slot in order. Provider fallback per slot; a dead slot
      // is skipped, never fatal. ac.signal checked between slots so Stop is instant. ──
      const priorIntents: string[] = [];
      for (const s of outline) {
        if (ac.signal.aborted) break;
        const tools = buildSlotTool(s.type, onBlock);
        for (const p of chain) {
          if (ac.signal.aborted) break;
          try {
            const result = streamText({
              model: p.model,
              system: "You fill exactly one block. Call your only tool once.",
              prompt: slotPrompt(topic, s, priorIntents),
              tools,
              stopWhen: stepCountIs(3),
              temperature: 0.7,
              maxRetries: 1,
              abortSignal: ac.signal,
            });
            await result.consumeStream();
            const usage = await result.usage;
            served = served ?? p.name;
            usedInput += usage.inputTokens ?? 0;
            usedOutput += usage.outputTokens ?? 0;
            break; // slot filled — next slot
          } catch (err) {
            if (ac.signal.aborted) break;
            const key = isFallthroughError(err) ? EVENTS.providerRatelimited : EVENTS.error;
            await emit(userId, key, { provider: p.name, slot: s.slot, message: String((err as Error).message) }, "server", sessionId);
            continue; // try the next provider for THIS slot
          }
        }
        priorIntents.push(s.intent);
        if (capped) break;
      }

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
      write({ t: "usage", provider: served, inputTokens: usedInput, outputTokens: usedOutput, blockCount, fallbackCount, fallbacks, repairs: changes.length });
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
