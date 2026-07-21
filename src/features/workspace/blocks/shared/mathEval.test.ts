import { describe, it, expect } from "vitest";
import { compileExpression } from "@/features/workspace/blocks/shared/mathEval";

describe("compileExpression", () => {
  it("evaluates arithmetic and precedence", () => {
    const f = compileExpression("2*x + 1");
    expect(f).not.toBeNull();
    expect(f!(3)).toBe(7);
    const g = compileExpression("x^2 + 2*x + 1");
    expect(g!(3)).toBe(16);
  });

  it("supports allowlisted functions and constants", () => {
    expect(compileExpression("sin(0)")!(0)).toBe(0);
    const c = compileExpression("cos(x)")!;
    expect(c(0)).toBeCloseTo(1, 10);
    const p = compileExpression("pi")!;
    expect(p(0)).toBeCloseTo(Math.PI, 10);
  });

  it("rejects unknown identifiers and illegal characters (no code execution)", () => {
    expect(compileExpression("alert(1)")).toBeNull();
    expect(compileExpression("x; while(1){}")).toBeNull();
    expect(compileExpression("window")).toBeNull();
    expect(compileExpression("x[0]")).toBeNull();
    expect(compileExpression("")).toBeNull();
  });

  it("rejects malformed expressions", () => {
    expect(compileExpression("2 +")).toBeNull();
    expect(compileExpression("(x")).toBeNull();
  });
});
