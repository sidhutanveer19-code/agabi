/**
 * Agabi API contract — the canonical, shared interface between the frontend and
 * the backend. Import from `@contract` on either side. Schemas + endpoints +
 * stream events + transport only.
 */
export * from "@contract/schemas";
export * from "@contract/endpoints";
export { TRANSPORT } from "@contract/transport";
