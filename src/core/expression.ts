/**
 * Small, safe arithmetic expression evaluator for user-defined cost models.
 * Supports numbers, the variable A, + − * / ^, parentheses, unary minus and
 * the functions sqrt, ln, log10, exp, abs, min, max. No eval().
 */

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`Bad number at position ${i + 1}`);
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if ('+-*/^(),'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else throw new Error(`Unexpected character "${c}"`);
  }
  return out;
}

type Node =
  | { k: 'num'; v: number }
  | { k: 'var' }
  | { k: 'neg'; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; f: string; args: Node[] };

const FUNCS: Record<string, (...x: number[]) => number> = {
  sqrt: Math.sqrt,
  ln: Math.log,
  log10: Math.log10,
  exp: Math.exp,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
};

function parse(tokens: Token[]): Node {
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}"`);
    p++;
  };
  function expr(): Node {
    let a = term();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[p++] as { v: string }).v;
      a = { k: 'bin', op, a, b: term() };
    }
    return a;
  }
  function term(): Node {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[p++] as { v: string }).v;
      a = { k: 'bin', op, a, b: unary() };
    }
    return a;
  }
  function unary(): Node {
    if (isOp('-')) {
      p++;
      return { k: 'neg', a: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  }
  function power(): Node {
    const base = atom();
    if (isOp('^')) {
      p++;
      return { k: 'bin', op: '^', a: base, b: unary() }; // right-associative
    }
    return base;
  }
  function atom(): Node {
    const tk = peek();
    if (!tk) throw new Error('Unexpected end of expression');
    if (tk.t === 'num') {
      p++;
      return { k: 'num', v: tk.v };
    }
    if (tk.t === 'id') {
      p++;
      if (tk.v === 'A' || tk.v === 'a') return { k: 'var' };
      const f = tk.v.toLowerCase();
      if (!(f in FUNCS)) throw new Error(`Unknown name "${tk.v}" (use A for area)`);
      expect('(');
      const args: Node[] = [expr()];
      while (isOp(',')) {
        p++;
        args.push(expr());
      }
      expect(')');
      return { k: 'call', f, args };
    }
    if (isOp('(')) {
      p++;
      const e = expr();
      expect(')');
      return e;
    }
    throw new Error(`Unexpected "${tk.v}"`);
  }
  const n = expr();
  if (p < tokens.length) throw new Error(`Unexpected "${(tokens[p] as { v: string | number }).v}"`);
  return n;
}

function evalNode(n: Node, A: number): number {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'var':
      return A;
    case 'neg':
      return -evalNode(n.a, A);
    case 'call':
      return FUNCS[n.f](...n.args.map((x) => evalNode(x, A)));
    case 'bin': {
      const a = evalNode(n.a, A);
      const b = evalNode(n.b, A);
      switch (n.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
        default:
          return Math.pow(a, b);
      }
    }
  }
}

export type Compiled = (A: number) => number;

const cache = new Map<string, Compiled | Error>();

/** Compile an expression in A. Throws an Error with a readable message if invalid. */
export function compileExpression(src: string): Compiled {
  const hit = cache.get(src);
  if (hit instanceof Error) throw hit;
  if (hit) return hit;
  try {
    const tree = parse(tokenize(src));
    const fn: Compiled = (A) => evalNode(tree, A);
    cache.set(src, fn);
    return fn;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    cache.set(src, err);
    throw err;
  }
}
