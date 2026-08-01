# What Makes a Good Architecture

This is the standard every Agabi design is judged against — the timeless principles behind how the
best-run engineering companies build (Google, Amazon, Stripe, Netflix, Meta, the Unix world). It is
written in plain language first, then named, then shown as the exact wall that already enforces it in
this codebase. If a design violates one of these, it is wrong — fix the design, not the principle.

The house metaphor runs throughout: **a good architecture is a well-built house, not a shed where
everything happens in one room.**

---

## 1. Each part has one job
**The rule.** The kitchen only makes food. The bedroom is only for sleeping. A bad architecture is a
single room where you cook, sleep, eat, and party — one place doing everything.

**The principle.** Single Responsibility / Separation of Concerns / bounded context. Unix: "do one
thing well." Amazon: one service, one job. A module you can describe in a single sentence without
"and" is correctly scoped.

**In Agabi.** The engine is split into named stages — acquire · parse · clean · normalise · chunk ·
persist · discover · extract · validate · resolve — each a separate file with one responsibility.
Frontend: camera store moves the camera, workspace store holds the document, ui store holds transient
selection. Never one store doing all three.

## 2. Clear walls — what may never touch what
**The rule.** Every part is told what it is never allowed to touch. The wall is written down, not
assumed.

**The principle.** Dependency rule / layering (Clean Architecture, Hexagonal). Dependencies point one
direction; inner layers never import outer ones. The forbidden edges are explicit.

**In Agabi.** `src/server/architecture.test.ts` (walls W1–W7) fails the build if a forbidden import
or cross-layer reach appears. AI reasoning may never write canonical storage without validation
(Law 36/37). The wall is a test, not a hope — see [CLAUDE.md](../CLAUDE.md) §C.

## 3. Connect only through doorways, never through holes
**The rule.** You enter the kitchen through its one door — not the window, not a hole in the wall.
Parts talk only through defined openings.

**The principle.** Explicit interfaces / encapsulation / API-as-contract. Amazon's 2002 mandate: every
team exposes data **only** through a service interface — no back doors, no shared database reach-in.
Stripe: the public API is the contract; internals stay private.

**In Agabi.** The frontend talks to the backend through exactly one seam — `TeachingProvider` →
`POST /teach` (NDJSON stream). Blocks talk to their library only inside `blocks/<name>/`. A URL enters
a block only through `safeUrl()`. One door each.

## 4. Written down — so any two builders build the identical house
**The rule.** The plan is clear enough that two builders who never meet produce the same house.

**The principle.** Design docs before code. Amazon's 6-pager, Google's design doc, RFCs, ADRs. The
document is the source of truth; code that disagrees with it is the bug.

**In Agabi.** The architecture is frozen in `docs/phase-2/FINAL/{00,01,02}.md`; each build has a written
`BLUEPRINT.md`. If code and a frozen doc disagree, **the doc wins** — report it, never resolve silently
in code ([CLAUDE.md](../CLAUDE.md) §K).

## 5. It says what it will NEVER be
**The rule.** A good plan states what the house must never turn into. It names the things to avoid at
all cost.

**The principle.** Explicit non-goals + named anti-patterns. Every strong design doc has a "Non-Goals"
section. Naming the failure mode is how you avoid drifting into it.

**Avoid at all cost (the bad house):**
- Everything can talk to everything (spaghetti / Big Ball of Mud)
- One giant part does all things (the God object / monolith-of-one-file)
- No written plan (tribal knowledge, un-reproducible)
- Unpredictable behavior (same action, different result each time)
- Silent failure (breaks quietly, no one notices)
- Rooms nobody uses (dead code, speculative generality)

**In Agabi.** Every blueprint carries a **Non-Goals** section ([CLAUDE.md](../CLAUDE.md) §G.11). Teaching
is append-only *by design* — there is deliberately no region-delete and no undo history.

## 6. Swap one part without breaking the others
**The rule.** Swap the fridge and the kitchen still works. Replacing a part does not require rebuilding
the house.

**The principle.** Loose coupling / replaceable modules / Ports & Adapters. "Design for deletion" —
if you can delete and replace a component cleanly, it was well-bounded. Netflix swaps services behind
stable interfaces without callers noticing.

**In Agabi.** Swapping a viz library touches exactly one `blocks/<name>/` folder — nothing else imports
it. The auth seam is one function (`getUserId`) — Clerk swaps in without touching callers. The teaching
backend is behind `TeachingProvider` — replaceable at one seam.

## 7. Add new things without tearing it down
**The rule.** Want a new room? Build an extension. Do not knock down the whole house.

**The principle.** Open/Closed — open for extension, closed for modification. Plugin architectures.
New features = new blueprints **under** the frozen architecture, never a rewrite ([CLAUDE.md](../CLAUDE.md)
§F.3).

**In Agabi.** Adding a block = create `blocks/<name>/` + one line in `manifest.ts`. Nothing else
changes. The registry is config-driven — no giant switch statement to edit.

## 8. Make the wrong thing impossible, not merely discouraged
**The rule.** A plug fits only one way — you physically cannot insert it backwards. Good design makes
mistakes impossible, not "please be careful."

**The principle.** Make illegal states unrepresentable / poka-yoke (mistake-proofing). Types and APIs
that only allow correct use. Stripe's idempotency keys make double-charges structurally impossible, not
just warned against.

**In Agabi.** Strict TypeScript, no `any` in public types. Zod schemas validate every block's data and
every event at the boundary — bad shapes are rejected, not tolerated. HMAC-signed identity cookie: you
cannot forge a userId. KaTeX `trust:false` / Mermaid `securityLevel:strict` make injection impossible,
not discouraged.

## 9. Test each part alone
**The rule.** You can test the kitchen without running the whole house. No need to rerun everything to
check one thing.

**The principle.** Independent testability / unit isolation / the test pyramid. If a part needs the
entire system booted to test, its boundaries are wrong.

**In Agabi.** The core logic suite (Vitest) tests pure logic in isolation; e2e (Playwright) is a thin
top layer. Every discovered bug becomes a permanent isolated regression test before the fix is done
([CLAUDE.md](../CLAUDE.md) §C.3, §H.12).

## 10. Same input, same result — no surprises
**The rule.** Flip the switch, the light comes on. Always. A bad house: flip the switch and sometimes
a fan runs, sometimes a light, sometimes nothing.

**The principle.** Determinism / idempotency / reproducibility. Pure functions where possible; the same
call yields the same outcome. "Make every production failure reproducible" ([CLAUDE.md](../CLAUDE.md)
§C.43).

**In Agabi.** Portability is proven by `export → import → verify:roundtrip` producing byte-identical
output. Conclusions are computed on read, never stored (mastery/efficacy are queries), so a given state
always yields the same answer.

## 11. When it breaks, it screams
**The rule.** A good house does not fail quietly. When something breaks, it is loud and obvious.

**The principle.** Fail loud / fail fast / crash-only. Erlang's "let it crash." Never swallow an error.
Silent failure is the most expensive kind — it looks like success.

**In Agabi.** Law 11: always fail loudly, never silently. Every drop/skip appends an `Omission` record
with a reason (R1) — a counter with no matching record is a defect. A failing block renders a visible
error card, never a blank.

## 12. Minimum parts — each earns its place
**The rule.** Build the rooms you need, not a 100-room mansion of empty rooms. Every part must justify
its existence.

**The principle.** Simplicity / YAGNI / "boring technology." Google and Amazon reward removing code.
The best code is deleted code — fewer parts, fewer failures. Delete before you add.

**In Agabi.** Law 49: remove unnecessary complexity before adding capability. §H.3: delete before you
add. The legacy client-side lesson composer was **removed** — there is exactly one teaching surface,
not two.

## 13. Grows without falling
**The rule.** 10 guests or 1,000 guests, the house holds. It grows without collapsing.

**The principle.** Scalability / graceful degradation / horizontal scale. Netflix and Amazon scale by
adding stateless parts, not by rebuilding. Under load, a good system degrades gracefully instead of
crashing.

**In Agabi.** The canvas virtualizes — culls off-screen blocks, so 10 or 1,000 blocks pan at the same
cost. Population is checkpointed and resumable — it scales across chapters without a single fragile
long-running job. When a concept isn't reviewed yet, teaching degrades to a clean fallback, never a
crash.

---

## The one-line test
Before shipping any design, ask of every part:
> One job? · Walls written? · One doorway? · On paper? · Non-goals named? · Swappable? · Extendable
> without a rewrite? · Wrong-use impossible? · Testable alone? · Deterministic? · Fails loud? ·
> Minimal? · Scales?

If any answer is no, the design is not done.
