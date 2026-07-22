/**
 * AI Teaching — frontend contract binding.
 *
 * The canonical request/event/status shapes live in the shared API contract
 * (`@contract`). The frontend re-exports them and defines only the local
 * consumer interface. Layout geometry (block height/position) is a frontend
 * concern and is NOT part of the wire contract.
 */
export type { TeachStatus, TeachRequest, TeachEvent, StreamedBlock, TeachContext } from "@contract";

import type { TeachRequest, TeachContext, TeachEvent } from "@contract";

/**
 * The teaching provider the workspace consumes. Implemented by the real backend
 * streaming service (`platform/services/teachingService`). `canvasId` scopes the
 * stream to one canvas (required — the memory boundary); `context` gives the backend
 * the current session state; `signal` cancels the stream.
 */
export interface TeachingProvider {
  teach(req: TeachRequest, context: TeachContext, signal: AbortSignal, canvasId: string): AsyncIterable<TeachEvent>;
}
