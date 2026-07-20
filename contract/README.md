# Agabi API Contract

The **canonical, shared interface** between the Agabi frontend and backend. Owned by
neither side. Contains only **schemas, endpoints, stream events, and transport rules** —
no business logic, no rendering, no backend behaviour. Copy this directory into the
backend repository (or publish it as a package) so both implement the same types.

## Ownership

- **Frontend** owns: rendering, animation, interaction, workspace UX, block rendering,
  local UI state, and *initiating* requests. It renders backend output and **calculates
  nothing** (no mastery, memory, confidence, recommendations, learning paths, lesson
  structure, or teaching strategy).
- **Backend** owns: AI, knowledge, retrieval, teaching, recommendation, memory, student
  modelling, observation, persistence, and all business rules.

## Endpoints (the whole surface)

| Method | Path | Frontend interaction | Backend owner |
|---|---|---|---|
| POST | `/teach` | enter topic / interrupt / ask | Teaching Engine + AI Gateway |
| GET/PUT | `/workspace/:id` | canvas load / autosave | Workspace Platform · Persistence |
| POST | `/events` | any student action (batched) | Observation Engine · Event Log |
| GET | `/session` | app load (identify student) | Student Platform · Auth |

Retrieval is **internal** to `/teach`. `student-state` (mastery/memory/twin) and
`recommendations` are backend-owned but **not exposed yet** — no frontend surface renders
them. Add them only when a real interaction requires them.

## Transport

- Auth: **httpOnly session cookie**; clients send `credentials: "include"`. CSRF via
  double-submit cookie echoed in the `x-csrf-token` header.
- `/teach` streams **newline-delimited JSON** (`application/x-ndjson`): one `TeachEvent`
  per line, over a chunked-fetch `ReadableStream`. Cancellable; partial streams are
  recoverable.
- Errors use the `ApiError` envelope `{ code, message, recoverable }`.
