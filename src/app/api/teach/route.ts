import crypto from "node:crypto";
import { streamText, stepCountIs } from "ai";
import { getUserId } from "@/server/auth";
import { checkRateLimit } from "@/server/rateLimit";
import { teachBodySchema } from "@contract/schemas";
import { providerChain, isFallthroughError } from "@/server/ai/providers";
import { buildTools } from "@/server/ai/blockTools";
import { adaptBlock } from "@/server/ai/validateBlock";
import { systemPrompt, userPrompt, regionTitle } from "@/server/ai/prompt";
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
  const { request, context } = parsed.data;

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

      write({ t: "region", title: regionTitle(request) });
      write({ t: "status", status: "generating" });

      const tools = buildTools(onBlock);
      let served: string | null = null;
      let lastErr: unknown = null;
      let usedInput = 0;
      let usedOutput = 0;

      for (const p of chain) {
        try {
          const result = streamText({
            model: p.model,
            system: systemPrompt(),
            prompt: userPrompt(request, context),
            tools,
            stopWhen: stepCountIs(22),
            temperature: 0.7,
            maxRetries: 1, // fail fast so a dead provider falls through quickly
            abortSignal: ac.signal,
          });
          await result.consumeStream();
          const usage = await result.usage;
          served = p.name;
          usedInput = usage.inputTokens ?? 0;
          usedOutput = usage.outputTokens ?? 0;
          await emit(
            userId,
            EVENTS.providerUsed,
            { provider: p.name, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, blockCount, fallbackCount },
            "server",
            sessionId,
          );
          break;
        } catch (err) {
          lastErr = err;
          if (ac.signal.aborted) {
            served = served ?? p.name; // capped or cancelled during this provider
            break;
          }
          // Any provider error → try the NEXT provider (one bad key/limit can't kill
          // the lesson). Only if the whole chain fails do we surface an error.
          if (isFallthroughError(err)) {
            await emit(userId, EVENTS.providerRatelimited, { provider: p.name, message: String((err as Error).message) }, "server", sessionId);
          } else {
            await emit(userId, EVENTS.error, { provider: p.name, message: String((err as Error).message) }, "server", sessionId);
          }
          continue;
        }
      }

      // Client interrupt (the only thing that aborts now — the block ceiling no
      // longer aborts) ends without a summary.
      if (ac.signal.aborted) {
        await emit(userId, EVENTS.lessonCancelled, { served, blockCount }, "server", sessionId);
        try { controller.close(); } catch { /* already closed */ }
        return;
      }

      if (!served && blockCount === 0) {
        write({ t: "status", status: "error" });
        write({ t: "error", recoverable: true, message: "The teacher is busy right now. Try again in a moment." });
        write({ t: "done" });
        await emit(userId, EVENTS.error, { message: String((lastErr as Error)?.message ?? "all_providers_failed") }, "server", sessionId);
        controller.close();
        return;
      }

      // Non-contract usage line — the frontend safely drops it (unknown `t`), but
      // instruments/harnesses can read real token cost per lesson.
      write({ t: "usage", provider: served, inputTokens: usedInput, outputTokens: usedOutput, blockCount, fallbackCount, fallbacks });
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
