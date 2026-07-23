# Knowledge Authoring Workspace — Lifecycle (W8)

The backend governance layer that moves a knowledge object through its publishing pipeline. **Not
UI** — the substrate the future authoring UIs sit on. Orthogonal to the trust ladder (trust = "how
sure are we?"; lifecycle = "where is it in the pipeline?"). Lives under `knowledge/lifecycle/`.

## States & legal transitions (`lifecycle.ts`)
```
DRAFT ──► IN_REVIEW ──► APPROVED ──► PUBLISHED ──► DEPRECATED ──► ARCHIVED
                              └──────► DEPRECATED
```
Monotonic-forward, because the history is append-only (L5) — there is no "un-review". Nothing skips
review; nothing publishes unapproved; ARCHIVED is terminal. **Rework = a new version** (a fresh DRAFT
that supersedes), never a backward edge. `DISPUTED` (§26.5) is a lateral flag, not a state.

## Derived, never stored (ADR-11)
`lifecycleOf({ trustLevel, superseded, decisions })` is a **pure function** — no new column, no table.
The review-event audit trail IS the transition history. Precedence: `ARCHIVE` → ARCHIVED;
superseded / `DEPRECATE` / `DEMOTE` → DEPRECATED; `PUBLISH` → PUBLISHED; trust above the human floor
(`AUTO_VALIDATED`) → APPROVED; any review touched it → IN_REVIEW; else DRAFT.

## Governed transitions (`transition.ts`)
`transitionStatement(store, id, to, actorId, reason)` — an **atomic append**: derive the current
state, reject an illegal move (`assertTransition`), then record a `ReviewEvent` whose decision drives
the derivation forward. **APPROVED** crosses the human floor, so it promotes trust through the one
atomic trust writer (`commitReview`, §26.2 — a human `actorId` is always required). Nothing is deleted.

## Workspace queries (`workspace.ts`)
`listByState` / `stateCounts` group every object by its derived state — the per-state work queues a
reviewer/author operates against, and the input to the review + coverage dashboards. Pure reads,
deterministic (sorted), nothing materialised.

## Maps onto existing primitives (no schema change)
DRAFT = MACHINE_PROPOSED · IN_REVIEW = a review event exists · APPROVED = trust above the human floor
(a human `ReviewEvent`) · PUBLISHED/DEPRECATED/ARCHIVED = the corresponding review decision · release
membership (§19) remains the durable "published snapshot".

Verified: `lifecycle/lifecycle.test.ts` (4) — legal/illegal transitions, pure derivation across all
states, a governed DRAFT→IN_REVIEW→APPROVED(→trust promoted)→PUBLISHED walk, and workspace grouping.
