import { describe, it, expect } from "vitest";
import { databaseName, isTestDatabase, assertConformanceDbSafe } from "@/server/knowledge/store/conformanceGuard";

describe("conformance DB guard — makes wiping a real corpus DB impossible", () => {
  it("extracts the database name, stripping query params", () => {
    expect(databaseName("postgresql://u:p@localhost:5432/agabi")).toBe("agabi");
    expect(databaseName("postgresql://u:p@localhost:5432/agabi_test?schema=public")).toBe("agabi_test");
    expect(databaseName("")).toBe("");
  });

  it("only a name with 'test' as a whole segment counts as a test DB", () => {
    expect(isTestDatabase("postgresql://u:p@h:5432/agabi_test")).toBe(true);
    expect(isTestDatabase("postgresql://u:p@h:5432/test_agabi")).toBe(true);
    expect(isTestDatabase("postgresql://u:p@h:5432/my-test-db")).toBe(true);
    expect(isTestDatabase("postgresql://u:p@h:5432/agabi")).toBe(false); // the dev/corpus DB
  });
  it("does NOT treat a prod DB with 'test' as a SUBSTRING as a test DB (red-team P1-F1)", () => {
    for (const prod of ["latest", "contest", "greatest", "attestation", "myapp_latest", "protest"]) {
      expect(isTestDatabase(`postgresql://u:p@h:5432/${prod}`)).toBe(false);
    }
  });

  it("BLOCKS the destructive run against a non-test DB (the corpus wipe)", () => {
    expect(() => assertConformanceDbSafe("postgresql://u:p@h:5432/agabi", false)).toThrow(/not a\s+test DB/);
  });

  it("BLOCKS an empty/unparseable DATABASE_URL rather than truncating blindly", () => {
    expect(() => assertConformanceDbSafe(undefined, false)).toThrow(/empty or unparseable/);
    expect(() => assertConformanceDbSafe("", false)).toThrow(/empty or unparseable/);
  });

  it("ALLOWS a test DB", () => {
    expect(() => assertConformanceDbSafe("postgresql://u:p@h:5432/agabi_test", false)).not.toThrow();
  });

  it("ALLOWS a non-test DB only with the explicit CONFORMANCE_ALLOW_NONTEST override", () => {
    expect(() => assertConformanceDbSafe("postgresql://u:p@h:5432/agabi", true)).not.toThrow();
  });
});
