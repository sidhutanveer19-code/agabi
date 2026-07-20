/**
 * Safe math-expression compiler — NO eval / Function.
 *
 * Compiles a string like `sin(x) + x^2/2` into a pure `(x) => number` via a
 * tokenizer + recursive-descent parser. Only numbers, `x`, `+ - * / ^`,
 * parentheses, an allowlist of Math functions, and the constants `pi`/`e` are
 * accepted. Anything else → the whole expression fails to compile (returns null),
 * so untrusted or AI-authored expressions can never execute arbitrary code.
 */

const FUNCS: Record<string, (a: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  exp: Math.exp, log: Math.log, ln: Math.log, log10: Math.log10, log2: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Tok =
  | { t: "num"; v: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "lp" }
  | { t: "rp" };

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) return null;
      toks.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      toks.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp" }); i++; continue; }
    return null; // any other character is rejected
  }
  return toks;
}

type NumFn = (x: number) => number;

/** Compile an expression to a numeric x→y function, or null if invalid. */
export function compileExpression(expr: string): NumFn | null {
  const toks = tokenize(expr);
  if (!toks || toks.length === 0) return null;

  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const eat = (): Tok => toks[pos++];
  const opValue = (): string | null => {
    const t = peek();
    return t && t.t === "op" ? t.v : null;
  };

  function parseExpr(): NumFn | null {
    let left: NumFn | null = parseTerm();
    if (!left) return null;
    let op = opValue();
    while (op === "+" || op === "-") {
      eat();
      const right = parseTerm();
      if (!right) return null;
      const l: NumFn = left;
      left = op === "+" ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
      op = opValue();
    }
    return left;
  }

  function parseTerm(): NumFn | null {
    let left: NumFn | null = parseFactor();
    if (!left) return null;
    let op = opValue();
    while (op === "*" || op === "/") {
      eat();
      const right = parseFactor();
      if (!right) return null;
      const l: NumFn = left;
      left = op === "*" ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
      op = opValue();
    }
    return left;
  }

  function parseFactor(): NumFn | null {
    const op = opValue();
    if (op === "-" || op === "+") {
      eat();
      const operand = parseFactor();
      if (!operand) return null;
      return op === "-" ? (x) => -operand(x) : operand;
    }
    const base = parsePrimary();
    if (!base) return null;
    if (opValue() === "^") {
      eat();
      const exp = parseFactor(); // right-associative
      if (!exp) return null;
      return (x) => Math.pow(base(x), exp(x));
    }
    return base;
  }

  function parsePrimary(): NumFn | null {
    const tok = peek();
    if (!tok) return null;
    if (tok.t === "num") { eat(); const v = tok.v; return () => v; }
    if (tok.t === "lp") {
      eat();
      const inner = parseExpr();
      if (!inner) return null;
      const close = peek();
      if (!close || close.t !== "rp") return null;
      eat();
      return inner;
    }
    if (tok.t === "id") {
      eat();
      const name = tok.v;
      const next = peek();
      if (next && next.t === "lp") {
        const fn = FUNCS[name];
        if (!fn) return null;
        eat();
        const arg = parseExpr();
        if (!arg) return null;
        const close = peek();
        if (!close || close.t !== "rp") return null;
        eat();
        return (x) => fn(arg(x));
      }
      if (name === "x") return (x) => x;
      if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
      return null;
    }
    return null;
  }

  const compiled = parseExpr();
  if (!compiled || pos !== toks.length) return null; // leftover tokens = invalid
  return compiled;
}
