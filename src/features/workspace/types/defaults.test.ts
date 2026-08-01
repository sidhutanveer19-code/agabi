import { describe, it, expect } from "vitest";
import { emptyDoc, DEFAULT_CAMERA } from "@/features/workspace/types/defaults";
import { workspaceDocSchema, cameraSchema } from "@/features/workspace/serialization/schema";

// The server (canvasRepo) seeds a Workspace row with emptyDoc()/DEFAULT_CAMERA, and
// the client reads it back through these schemas. If the builder and the schema ever
// drift, the canvas renders empty with no obvious cause — so assert they agree.
describe("workspace defaults match the read schemas", () => {
  it("emptyDoc() passes workspaceDocSchema", () => {
    expect(workspaceDocSchema.safeParse(emptyDoc()).success).toBe(true);
    expect(workspaceDocSchema.safeParse(emptyDoc("Quadratic Equations")).success).toBe(true);
  });

  it("DEFAULT_CAMERA passes cameraSchema", () => {
    expect(cameraSchema.safeParse(DEFAULT_CAMERA).success).toBe(true);
  });
});
