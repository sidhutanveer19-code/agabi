import type { TeachEvent, TeachRequest, TeachingProvider } from "@/features/workspace/ai/types";
import { planLesson, planCommand, titleFor } from "@/features/workspace/ai/mock/lessonPlans";
import { textData } from "@/features/workspace/ai/mock/content";

/** Resolve after `ms`, or immediately when aborted. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

const VISUAL_TYPES = new Set(["chart", "basic-diagram", "flow", "mermaid", "threed", "molecule", "map", "graph"]);

/**
 * The mock teaching provider. Emits a scripted event stream with human-paced
 * delays: status → region → blocks (each appearing on its own), with text blocks
 * filling in word-by-word (token streaming). Fully cancellable via the signal.
 *
 * This is the Phase-6 swap point — the real backend implements `teach` with the
 * same event shapes and the entire UI keeps working unchanged.
 */
export const mockProvider: TeachingProvider = {
  async *teach(req: TeachRequest, signal: AbortSignal): AsyncGenerator<TeachEvent> {
    yield { t: "status", status: "thinking" };
    await delay(420, signal);
    if (signal.aborted) return yield { t: "status", status: "cancelled" };

    const plan = req.kind === "lesson" ? planLesson(req.topic) : planCommand(req);

    yield { t: "status", status: "planning" };
    await delay(320, signal);
    if (signal.aborted) return yield { t: "status", status: "cancelled" };

    yield { t: "region", title: titleFor(req) };
    yield { t: "status", status: "generating" };

    let index = 0;
    for (const block of plan) {
      if (signal.aborted) return yield { t: "status", status: "cancelled" };

      if (VISUAL_TYPES.has(block.type)) yield { t: "status", status: "visualizing" };

      // Text blocks arrive empty then fill in; others arrive whole.
      if (block.streamText) {
        yield { t: "block", block: { ...block, data: textData("") } };
        const words = block.streamText.split(" ");
        let acc = "";
        for (const w of words) {
          if (signal.aborted) return yield { t: "status", status: "cancelled" };
          acc += (acc ? " " : "") + w;
          await delay(38, signal);
          yield { t: "patch", index, data: textData(acc) };
        }
      } else {
        yield { t: "block", block };
        await delay(300, signal);
      }
      index += 1;
    }

    yield { t: "status", status: "finished" };
    yield { t: "done" };
  },
};
