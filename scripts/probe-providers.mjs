// D2 provider probe — verify TOOL CALLING (not just chat) on each free provider
// before trusting it in the chain. Run once keys are set:  node scripts/probe-providers.mjs
// Prints a PASS/FAIL/ERROR table. Providers without a key are skipped.
import { generateText, tool, stepCountIs } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

const providers = [];
if (process.env.GOOGLE_API_KEY)
  providers.push(["google:gemini-2.0-flash", createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY })("gemini-2.0-flash")]);
if (process.env.GROQ_API_KEY)
  providers.push(["groq:llama-3.3-70b-versatile", createGroq({ apiKey: process.env.GROQ_API_KEY })("llama-3.3-70b-versatile")]);
if (process.env.CEREBRAS_API_KEY)
  providers.push(["cerebras:llama-3.3-70b", createOpenAICompatible({ name: "cerebras", baseURL: "https://api.cerebras.ai/v1", apiKey: process.env.CEREBRAS_API_KEY })("llama-3.3-70b")]);
if (process.env.NVIDIA_API_KEY)
  providers.push(["nvidia:llama-3.3-70b", createOpenAICompatible({ name: "nvidia", baseURL: "https://integrate.api.nvidia.com/v1", apiKey: process.env.NVIDIA_API_KEY })("meta/llama-3.3-70b-instruct")]);
if (process.env.OLLAMA_BASE_URL)
  providers.push(["ollama:llama3.3", createOpenAICompatible({ name: "ollama", baseURL: process.env.OLLAMA_BASE_URL, apiKey: "ollama" })("llama3.3")]);

const emit_block = tool({
  description: "Emit one educational block.",
  inputSchema: z.object({ type: z.string(), text: z.string() }),
  execute: async () => ({ ok: true }),
});

if (providers.length === 0) {
  console.log("No provider keys set. Add GOOGLE_API_KEY / GROQ_API_KEY / … and re-run.");
  process.exit(0);
}

console.log("provider                          | tool-calling");
console.log("----------------------------------|-------------");
for (const [name, model] of providers) {
  try {
    const r = await generateText({
      model,
      tools: { emit_block },
      stopWhen: stepCountIs(2),
      prompt: "Call the emit_block tool exactly once with type 'paragraph' and text 'hello'.",
    });
    const calls = (r.toolCalls?.length ?? 0) + (r.steps?.reduce((n, s) => n + (s.toolCalls?.length ?? 0), 0) ?? 0);
    console.log(`${name.padEnd(33)} | ${calls > 0 ? "PASS" : "FAIL (no tool call)"}`);
  } catch (e) {
    console.log(`${name.padEnd(33)} | ERROR ${e.message?.slice(0, 60)}`);
  }
}
