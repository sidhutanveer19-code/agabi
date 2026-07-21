import { describe, it, expect } from "vitest";
import { serialize, deserialize } from "@/features/workspace/serialization/serialize";
import { SCHEMA_VERSION, type WorkspaceDoc } from "@/features/workspace/types";

function makeDoc(): WorkspaceDoc {
  return {
    id: "ws-test",
    schemaVersion: SCHEMA_VERSION,
    topic: "photosynthesis",
    createdAt: 1000,
    updatedAt: 2000,
    regions: [
      {
        id: "r1",
        title: "Explanation",
        position: { x: 0, y: 0 },
        size: { w: 400, h: 300 },
        createdAt: 1500,
        blocks: [
          { id: "b1", type: "heading", position: { x: 10, y: 10 }, size: { w: 200, h: 40 }, z: 0, data: { text: "Hi" } },
        ],
      },
    ],
  };
}

describe("serialize / deserialize", () => {
  it("round-trips a valid document", () => {
    const doc = makeDoc();
    const restored = deserialize(serialize(doc));
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(doc.id);
    expect(restored!.regions).toHaveLength(1);
    expect(restored!.regions[0].blocks[0].id).toBe("b1");
  });

  it("returns null on malformed JSON", () => {
    expect(deserialize("{not json")).toBeNull();
    expect(deserialize("null")).toBeNull();
    expect(deserialize("[]")).toBeNull();
  });

  it("rejects a document from an incompatible schema version", () => {
    const doc = makeDoc();
    doc.schemaVersion = SCHEMA_VERSION + 1;
    expect(deserialize(serialize(doc))).toBeNull();
  });

  it("rejects a document with a wrong shape", () => {
    expect(deserialize(JSON.stringify({ id: "x", schemaVersion: SCHEMA_VERSION }))).toBeNull();
  });
});
