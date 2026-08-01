import { describe, it, expect } from "vitest";
import { compileExpression } from "@/features/workspace/blocks/shared/mathEval";

/**
 * Mutation-grade coverage for the safe math evaluator (§H1). Every exported
 * function is `compileExpression`, but it wraps a tokenizer + recursive-descent
 * parser whose EVERY branch must be pinned: both sides of each operator ternary,
 * left- vs right-associativity, each early-return null, the finite-number guard,
 * the leftover-token guard, and the security allowlist (unknown id / illegal
 * char / non-function id-call all reject, so no arbitrary code can run).
 *
 * Assertions use exact values (`toBe`) for integer-exact arithmetic and
 * `toBeCloseTo` only for genuinely transcendental results — never a bare
 * "not null" without a computed expectation.
 */

// Small helper: compile then assert non-null, returning the callable.
function fn(expr: string) {
  const f = compileExpression(expr);
  expect(f, `expected "${expr}" to compile`).not.toBeNull();
  return f!;
}

describe("compileExpression — tokenizer", () => {
  it("skips spaces AND tabs between tokens (both whitespace branches)", () => {
    expect(fn("2 + 3")(0)).toBe(5); // space
    expect(fn("2\t+\t3")(0)).toBe(5); // tab
    expect(fn(" \t 2 \t * \t x \t ")(4)).toBe(8); // leading/mixed whitespace
  });

  it("does NOT treat newline as whitespace — any other char is rejected", () => {
    expect(compileExpression("1\n2")).toBeNull();
    expect(compileExpression("2\r3")).toBeNull();
  });

  it("parses multi-digit and decimal number literals", () => {
    expect(fn("42")(0)).toBe(42);
    expect(fn("3.5")(0)).toBe(3.5);
    expect(fn("1000")(0)).toBe(1000);
    expect(fn("0.25")(0)).toBe(0.25);
  });

  it("rejects a number literal that is not finite (bad dot runs)", () => {
    expect(compileExpression(".")).toBeNull(); // Number(".") === NaN
    expect(compileExpression("1.2.3")).toBeNull(); // Number("1.2.3") === NaN
    expect(compileExpression("..")).toBeNull();
  });

  it("parses identifiers containing digits/underscore (continuation regex)", () => {
    // log10 / log2 must tokenize as ONE id, not "log" + "10".
    expect(fn("log10(1000)")(0)).toBeCloseTo(3, 10);
    expect(fn("log2(8)")(0)).toBeCloseTo(3, 10);
  });

  it("rejects any character outside the grammar", () => {
    for (const bad of ["%", ",", "@", "!", "#", "[", "]", "{", "}", "x & 1", "x < 1", "x = 1"]) {
      expect(compileExpression(bad), `"${bad}" should be rejected`).toBeNull();
    }
  });

  it("returns null for empty or whitespace-only input (no tokens)", () => {
    expect(compileExpression("")).toBeNull();
    expect(compileExpression("   ")).toBeNull();
    expect(compileExpression("\t\t")).toBeNull();
  });
});

describe("compileExpression — additive/multiplicative arithmetic", () => {
  it("evaluates + and - and is LEFT-associative", () => {
    expect(fn("5 + 2")(0)).toBe(7);
    expect(fn("5 - 2")(0)).toBe(3);
    expect(fn("10 - 3 - 2")(0)).toBe(5); // (10-3)-2, not 10-(3-2)=9
    expect(fn("1 - 2 + 3")(0)).toBe(2); // left-assoc mix
  });

  it("evaluates * and / and is LEFT-associative", () => {
    expect(fn("2 * 3")(0)).toBe(6);
    expect(fn("6 / 2")(0)).toBe(3);
    expect(fn("12 / 2 / 3")(0)).toBe(2); // (12/2)/3, not 12/(2/3)=18
    expect(fn("2 * 3 / 4")(0)).toBe(1.5);
  });

  it("gives * and / higher precedence than + and -", () => {
    expect(fn("2 + 3 * 4")(0)).toBe(14);
    expect(fn("2 * 3 + 4")(0)).toBe(10);
    expect(fn("10 - 6 / 2")(0)).toBe(7);
  });

  it("performs real division (Infinity, not a thrown error, on /0)", () => {
    const f = fn("1 / x");
    expect(f(0)).toBe(Infinity);
    expect(f(4)).toBe(0.25);
  });

  it("returns null when a binary operator has no right operand", () => {
    expect(compileExpression("2 +")).toBeNull();
    expect(compileExpression("2 -")).toBeNull();
    expect(compileExpression("2 *")).toBeNull();
    expect(compileExpression("2 /")).toBeNull();
  });

  it("returns null when an operator has no left operand", () => {
    expect(compileExpression("* x")).toBeNull();
    expect(compileExpression("/ 2")).toBeNull();
    expect(compileExpression("^ 2")).toBeNull();
  });
});

describe("compileExpression — unary +/-", () => {
  it("applies a leading unary minus (negation)", () => {
    expect(fn("-5")(0)).toBe(-5);
    expect(fn("-x")(3)).toBe(-3);
  });

  it("treats a leading unary plus as identity (NOT negation)", () => {
    expect(fn("+5")(0)).toBe(5);
    expect(fn("+x")(3)).toBe(3);
  });

  it("supports a unary operator on the right of a binary operator", () => {
    expect(fn("2 * -3")(0)).toBe(-6);
    expect(fn("2 + -3")(0)).toBe(-1);
  });

  it("stacks unary minuses (double negation cancels)", () => {
    expect(fn("--x")(4)).toBe(4);
    expect(fn("- -5")(0)).toBe(5);
  });

  it("binds unary minus LOOSER than ^ (-x^2 === -(x^2))", () => {
    expect(fn("-x^2")(3)).toBe(-9); // not (-3)^2 === 9
  });

  it("returns null when a unary operator has no operand", () => {
    expect(compileExpression("-")).toBeNull();
    expect(compileExpression("+")).toBeNull();
    expect(compileExpression("2 * -")).toBeNull();
  });
});

describe("compileExpression — power (^) is right-associative", () => {
  it("evaluates ^", () => {
    expect(fn("2 ^ 3")(0)).toBe(8);
    expect(fn("x ^ 2")(5)).toBe(25);
  });

  it("is RIGHT-associative", () => {
    expect(fn("2 ^ 3 ^ 2")(0)).toBe(512); // 2^(3^2)=2^9, not (2^3)^2=64
  });

  it("binds tighter than * (2*x^2)", () => {
    expect(fn("2 * x ^ 2")(3)).toBe(18); // 2*(3^2)=18, not (2*3)^2=36
  });

  it("returns null when ^ has no exponent", () => {
    expect(compileExpression("2 ^")).toBeNull();
    expect(compileExpression("x ^")).toBeNull();
  });
});

describe("compileExpression — allowlisted functions", () => {
  it("trigonometric", () => {
    expect(fn("sin(x)")(0)).toBe(0);
    expect(fn("cos(x)")(0)).toBe(1);
    expect(fn("tan(x)")(0)).toBe(0);
  });

  it("inverse trigonometric", () => {
    expect(fn("asin(x)")(1)).toBeCloseTo(Math.PI / 2, 12);
    expect(fn("acos(x)")(1)).toBe(0);
    expect(fn("atan(x)")(1)).toBeCloseTo(Math.PI / 4, 12);
  });

  it("hyperbolic", () => {
    expect(fn("sinh(x)")(0)).toBe(0);
    expect(fn("cosh(x)")(0)).toBe(1);
    expect(fn("tanh(x)")(0)).toBe(0);
  });

  it("roots and absolute value", () => {
    expect(fn("sqrt(x)")(9)).toBe(3);
    expect(fn("cbrt(x)")(27)).toBe(3);
    expect(fn("abs(x)")(-5)).toBe(5);
    expect(fn("abs(x)")(5)).toBe(5);
  });

  it("exponential and logarithms (ln === log)", () => {
    expect(fn("exp(x)")(0)).toBe(1);
    expect(fn("exp(x)")(1)).toBeCloseTo(Math.E, 12);
    expect(fn("ln(x)")(1)).toBe(0);
    expect(fn("log(x)")(1)).toBe(0); // log is natural log here
    expect(fn("log(e)")(0)).toBeCloseTo(1, 12); // ln(e) === 1
    expect(fn("log10(x)")(1000)).toBeCloseTo(3, 10);
    expect(fn("log2(x)")(8)).toBeCloseTo(3, 10);
  });

  it("rounding and sign", () => {
    expect(fn("floor(x)")(2.7)).toBe(2);
    expect(fn("ceil(x)")(2.1)).toBe(3);
    expect(fn("round(x)")(2.5)).toBe(3);
    expect(fn("round(x)")(2.4)).toBe(2);
    expect(fn("sign(x)")(-3)).toBe(-1);
    expect(fn("sign(x)")(0)).toBe(0);
    expect(fn("sign(x)")(5)).toBe(1);
  });

  it("accepts a full expression as a function argument", () => {
    expect(fn("sqrt(x ^ 2)")(-4)).toBe(4);
    expect(fn("abs(-5)")(0)).toBe(5); // unary minus inside the call
    expect(fn("sin(x + x)")(0)).toBe(0);
  });

  it("composes nested function calls", () => {
    expect(fn("sqrt(abs(x))")(-16)).toBe(4);
    expect(fn("cos(sin(x))")(0)).toBe(1); // cos(0) === 1
  });

  it("rejects an unknown function name (allowlist only)", () => {
    expect(compileExpression("foo(x)")).toBeNull();
    expect(compileExpression("sec(x)")).toBeNull();
    expect(compileExpression("SIN(x)")).toBeNull(); // case-sensitive
    expect(compileExpression("alert(1)")).toBeNull();
  });

  it("rejects calling a non-function identifier like x() or pi()", () => {
    expect(compileExpression("x(2)")).toBeNull();
    expect(compileExpression("pi(2)")).toBeNull();
  });

  it("returns null when a function call has no argument", () => {
    expect(compileExpression("sin()")).toBeNull();
  });

  it("returns null when a function call is missing its closing paren", () => {
    expect(compileExpression("sin(x")).toBeNull(); // close undefined
    expect(compileExpression("sin(x x)")).toBeNull(); // close present but not ')'
  });

  it("rejects a function name used without parentheses", () => {
    expect(compileExpression("sin")).toBeNull();
    expect(compileExpression("sin + 1")).toBeNull();
  });
});

describe("compileExpression — constants", () => {
  it("resolves pi and e to their Math values", () => {
    expect(fn("pi")(0)).toBeCloseTo(Math.PI, 12);
    expect(fn("e")(0)).toBeCloseTo(Math.E, 12);
    expect(fn("2 * pi")(0)).toBeCloseTo(2 * Math.PI, 12);
  });

  it("is case-sensitive for constant names", () => {
    expect(compileExpression("PI")).toBeNull();
    expect(compileExpression("E")).toBeNull();
  });

  it("rejects any other bare identifier", () => {
    expect(compileExpression("y")).toBeNull();
    expect(compileExpression("foo")).toBeNull();
    expect(compileExpression("window")).toBeNull();
  });
});

describe("compileExpression — parentheses and grouping", () => {
  it("overrides precedence with grouping", () => {
    expect(fn("(2 + 3) * 4")(0)).toBe(20);
    expect(fn("2 * (x + 1)")(3)).toBe(8);
    expect(fn("((x))")(7)).toBe(7); // nested redundant parens
  });

  it("returns null for empty parentheses", () => {
    expect(compileExpression("()")).toBeNull();
  });

  it("returns null for an unclosed group", () => {
    expect(compileExpression("(x")).toBeNull(); // close undefined
    expect(compileExpression("(x + 1")).toBeNull();
  });

  it("returns null when the closer is present but not ')'", () => {
    expect(compileExpression("(x x)")).toBeNull(); // token after inner is an id, not ')'
  });

  it("returns null for a lone '(' (empty inner expression)", () => {
    expect(compileExpression("(")).toBeNull();
  });
});

describe("compileExpression — leftover / structural rejection", () => {
  it("rejects trailing tokens after a complete expression", () => {
    expect(compileExpression("x)")).toBeNull(); // valid 'x' then stray ')'
    expect(compileExpression("2 2")).toBeNull();
    expect(compileExpression("x x")).toBeNull();
    expect(compileExpression("1 + 2 3")).toBeNull();
  });

  it("rejects an expression that is only an operator or closer", () => {
    expect(compileExpression("*")).toBeNull();
    expect(compileExpression(")")).toBeNull();
    expect(compileExpression("/")).toBeNull();
  });

  it("does not execute arbitrary code embedded in the string", () => {
    expect(compileExpression("x; while(1){}")).toBeNull(); // ';' illegal char
    expect(compileExpression("x[0]")).toBeNull(); // '[' illegal char
    expect(compileExpression("this")).toBeNull(); // bare id, not x/const/func
    expect(compileExpression("eval(x)")).toBeNull(); // not an allowlisted function
  });
});

describe("compileExpression — the compiled function re-reads x each call", () => {
  it("is a pure x->y function evaluated fresh per input", () => {
    const f = fn("x ^ 2 + 1");
    expect(f(0)).toBe(1);
    expect(f(2)).toBe(5);
    expect(f(3)).toBe(10);
    expect(f(-2)).toBe(5);
  });

  it("evaluates a rich mixed expression correctly", () => {
    // 2*sin(0) + 3^2 - 4/2 = 0 + 9 - 2 = 7
    expect(fn("2 * sin(x) + 3 ^ 2 - 4 / 2")(0)).toBe(7);
  });
});
