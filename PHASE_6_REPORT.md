# Agabi — Phase 6 Complete (Milestone Report)

Backend integration. The frontend becomes a **presentation layer over a real
backend**: it initiates requests, renders backend output, persists through the
backend, and emits events — and **calculates/generates nothing**. No backend is
built here; the deliverable is the **shared API contract** + the full typed client.
Snapshot: tag `phase-6-complete`, branch `release/phase-6`.

---

## Deliverables

### 1. Shared API contract — `/contract` (standalone, neutral)
Owned by neither side; copy into the backend repo (`@contract` path alias).
**Schemas, endpoints, stream events, transport only — no business logic.** Zod +
inferred types: `TeachRequest`, `TeachEvent`, `StreamedBlock`, `WorkspaceDoc`,
`WorkspaceState`, `StudentEvent`, `Session`, `ApiError`.

### 2. API — the smallest correct surface (4 endpoints)
Every endpoint justified by a real frontend interaction:

| Method | Path | Interaction | Backend owner |
|---|---|---|---|
| POST | `/teach` (NDJSON stream) | enter topic / interrupt / ask | Teaching Engine + AI Gateway |
| GET/PUT | `/workspace/:id` | canvas load / autosave | Workspace Platform · Persistence |
| POST | `/events` | any student action (batched) | Observation Engine · Event Log |
| GET | `/session` | app load (identify student) | Student Platform · Auth |

Deliberately NOT added (no UI needs them yet): `/retrieve` (internal to `/teach`),
`/student-state` (mastery/memory/twin), `/recommendations`.

### 3. Service architecture — `src/features/platform/`
No fetch in components. `apiClient` (credentials:"include", CSRF, typed errors,
retry/backoff, timeout, 401→session-expired) + `streamClient` (NDJSON reader) →
`teachingService` / `workspaceService` / `eventService` / `sessionService`.
`providers.ts` is the single switch (backend vs local offline cache).

### 4. Streaming
Chunked-fetch `ReadableStream` → NDJSON → validated `TeachEvent`s. Cancellable,
partial-line buffered. The backend does all generation; the frontend only relays.
Block geometry (height) stays a frontend concern — the wire carries none.

### 5. Auth
httpOnly session cookie (`credentials: "include"`), CSRF double-submit
(`x-csrf-token`). `SessionProvider` loads `/session`; 401 → `SessionBanner`. No
login screen invented — just the seam.

### 6. Persistence
`workspaceService` GET/PUT `/workspace/:id` (doc + camera), same
`WorkspacePersistence` interface — autosave/restore unchanged. Fixed a restore race
(async backend restore was re-teaching over a restored session; auto-teach now runs
only after restore resolves).

### 7. Events
`eventBus.emit(...)` — batched, async, non-blocking, best-effort. Emits
`topic_opened` / `lesson_started` / `command` / `question` / `lesson_completed`.

### 8. Mock removed from the app
`ai/mock/` deleted. All lesson generation lives only in a standalone **dev-backend
stub** (`dev-backend/server.mjs`, plain JS, not bundled) so local dev has a backend
to talk to. `grep` confirms zero generation in `src/`.

---

## Verification
- `tsc` 0 · `eslint` 0 · `next build` 0.
- Real path (app → `dev-backend` on :8787): `POST /teach` streamed a lesson (blocks
  render, UI identical to Phase 5); `PUT`/`GET /workspace` persisted + **restored on
  reload with no re-teach**; `/events` batches received; `/session` loaded. Zero
  console errors.
- No backend → graceful recoverable error (presentation layer, by design).
- Phase 1–5 frozen: block library, stores, camera, and `src/app/page.tsx` unchanged;
  Phase 6 is additive (`contract/`, `platform/`, `dev-backend/`) + the teaching /
  persistence seam swaps.

---

## Reserved for Phase 7 (NOT built)
The real backend engines (AI Gateway, Knowledge, Retrieval, Teaching, Recommendation,
Memory, Mastery, Observation, Digital Twin, Event Log, Student Platform/auth) and any
UI for student-state / recommendations (add those endpoints when a surface needs them).

## Run
```bash
npm run dev:backend                                          # dev backend stub (:8787)
NEXT_PUBLIC_API_BASE_URL=http://localhost:8787 npm run dev   # app → real path
```
- Checkout: `git checkout phase-6-complete` (or branch `release/phase-6`).
- Archives: `~/Desktop/agabi-phase-6-complete.zip` / `.tar.gz`.
