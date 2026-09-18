// Tokenizer and recursive-descent parser for the SQL-WHERE-like expression language.

export class ExprError extends Error {
  constructor(message: string, public pos: number, public end: number = pos + 1) {
    super(message);
  }
}

type TokKind = 'num' | 'str' | 'ident' | 'op' | 'eof';

interface Token {
  kind: TokKind;
  text: string;
  value?: number | string;
  pos: number;
  end: number;
}

const OPERATORS = ['<=', '>=', '<>', '!=', '==', '&&', '||', '=', '<', '>', '+', '-', '*', '/', '%', '^', '(', ')', ',', '!'];

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let p = 0;
  while (p < src.length) {
    const ch = src[p];
    if (/\s/.test(ch)) {
      p++;
      continue;
    }
    const start = p;
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[p + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(p))!;
      p += m[0].length;
      if (/[A-Za-z_]/.test(src[p] ?? '')) throw new ExprError(`Invalid number "${src.slice(start, p + 1)}"`, start, p + 1);
      toks.push({ kind: 'num', text: m[0], value: parseFloat(m[0]), pos: start, end: p });
      continue;
    }
    if (ch === "'" || ch === '"') {
      let s = '';
      p++;
      for (;;) {
        if (p >= src.length) throw new ExprError('Unterminated string', start, src.length);
        if (src[p] === ch) {
          if (src[p + 1] === ch) {
            s += ch;
            p += 2;
            continue;
          }
          p++;
          break;
        }
        s += src[p++];
      }
      toks.push({ kind: 'str', text: src.slice(start, p), value: s, pos: start, end: p });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(p))!;
      p += m[0].length;
      toks.push({ kind: 'ident', text: m[0], pos: start, end: p });
      continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, p));
    if (!op) throw new ExprError(`Unexpected character "${ch}"`, p);
    p += op.length;
    toks.push({ kind: 'op', text: op, pos: start, end: p });
  }
  toks.push({ kind: 'eof', text: '', pos: src.length, end: src.length });
  return toks;
}

interface Span {
  pos: number;
  end: number;
}

export type BinOp = '+' | '-' | '*' | '/' | '%' | '^' | 'and' | 'or' | '=' | '!=' | '<' | '<=' | '>' | '>=';

export type Node = Span &
  (
    | { k: 'num'; v: number }
    | { k: 'str'; v: string }
    | { k: 'bool'; v: boolean }
    | { k: 'null' }
    | { k: 'ident'; name: string }
    | { k: 'call'; name: string; nameSpan: Span; args: Node[] }
    | { k: 'neg'; arg: Node }
    | { k: 'not'; arg: Node }
    | { k: 'bin'; op: BinOp; l: Node; r: Node }
    | { k: 'like'; neg: boolean; ci: boolean; l: Node; r: Node }
    | { k: 'in'; neg: boolean; l: Node; items: Node[] }
    | { k: 'between'; neg: boolean; l: Node; lo: Node; hi: Node }
    | { k: 'isnull'; neg: boolean; arg: Node }
    | { k: 'has'; neg: boolean; list: Node; item: Node }
  );

const KEYWORDS = new Set(['and', 'or', 'not', 'like', 'ilike', 'in', 'between', 'is', 'null', 'true', 'false', 'has']);

export function parse(src: string): Node {
  const toks = tokenize(src);
  let t = 0;
  const peek = () => toks[t];
  const next = () => toks[t++];
  const isKw = (tok: Token, kw: string) => tok.kind === 'ident' && tok.text.toLowerCase() === kw;
  const isOp = (tok: Token, op: string) => tok.kind === 'op' && tok.text === op;
  const span = (a: Span, b: Span): Span => ({ pos: a.pos, end: b.end });

  function expectOp(op: string): Token {
    const tok = next();
    if (!isOp(tok, op)) throw new ExprError(tok.kind === 'eof' ? `Expected "${op}" but the expression ended` : `Expected "${op}"`, tok.pos, tok.end);
    return tok;
  }

  function parseOr(): Node {
    let l = parseAnd();
    while (isKw(peek(), 'or') || isOp(peek(), '||')) {
      next();
      const r = parseAnd();
      l = { k: 'bin', op: 'or', l, r, ...span(l, r) };
    }
    return l;
  }

  function parseAnd(): Node {
    let l = parseNot();
    while (isKw(peek(), 'and') || isOp(peek(), '&&')) {
      next();
      const r = parseNot();
      l = { k: 'bin', op: 'and', l, r, ...span(l, r) };
    }
    return l;
  }

  function parseNot(): Node {
    if (isKw(peek(), 'not') || isOp(peek(), '!')) {
      const tok = next();
      const arg = parseNot();
      return { k: 'not', arg, pos: tok.pos, end: arg.end };
    }
    return parseCmp();
  }

  function parseCmp(): Node {
    const l = parseAdd();
    const tok = peek();
    if (tok.kind === 'op' && ['=', '==', '!=', '<>', '<', '<=', '>', '>='].includes(tok.text)) {
      next();
      const r = parseAdd();
      const op = (tok.text === '==' ? '=' : tok.text === '<>' ? '!=' : tok.text) as BinOp;
      return { k: 'bin', op, l, r, ...span(l, r) };
    }
    if (isKw(tok, 'is')) {
      next();
      let neg = false;
      if (isKw(peek(), 'not')) {
        next();
        neg = true;
      }
      const nullTok = next();
      if (!isKw(nullTok, 'null')) throw new ExprError('Expected NULL after IS', nullTok.pos, nullTok.end);
      return { k: 'isnull', neg, arg: l, pos: l.pos, end: nullTok.end };
    }
    let neg = false;
    if (isKw(tok, 'not')) {
      const after = toks[t + 1];
      if (['like', 'ilike', 'in', 'between', 'has'].some((kw) => isKw(after, kw))) {
        next();
        neg = true;
      } else {
        return l;
      }
    }
    const kwTok = peek();
    if (isKw(kwTok, 'like') || isKw(kwTok, 'ilike')) {
      next();
      const r = parseAdd();
      return { k: 'like', neg, ci: isKw(kwTok, 'ilike'), l, r, ...span(l, r) };
    }
    if (isKw(kwTok, 'has')) {
      next();
      const item = parseAdd();
      return { k: 'has', neg, list: l, item, ...span(l, item) };
    }
    if (isKw(kwTok, 'in')) {
      next();
      if (isOp(peek(), '(')) {
        next();
        const items: Node[] = [parseOr()];
        while (isOp(peek(), ',')) {
          next();
          items.push(parseOr());
        }
        const close = expectOp(')');
        return { k: 'in', neg, l, items, pos: l.pos, end: close.end };
      }
      // "'Roguelike' in tags" is sugar for "tags has 'Roguelike'".
      const list = parseAdd();
      return { k: 'has', neg, list, item: l, ...span(l, list) };
    }
    if (isKw(kwTok, 'between')) {
      next();
      const lo = parseAdd();
      const andTok = next();
      if (!isKw(andTok, 'and')) throw new ExprError('Expected AND in BETWEEN … AND …', andTok.pos, andTok.end);
      const hi = parseAdd();
      return { k: 'between', neg, l, lo, hi, ...span(l, hi) };
    }
    return l;
  }

  function parseAdd(): Node {
    let l = parseMul();
    while (isOp(peek(), '+') || isOp(peek(), '-')) {
      const op = next().text as BinOp;
      const r = parseMul();
      l = { k: 'bin', op, l, r, ...span(l, r) };
    }
    return l;
  }

  function parseMul(): Node {
    let l = parseUnary();
    while (isOp(peek(), '*') || isOp(peek(), '/') || isOp(peek(), '%')) {
      const op = next().text as BinOp;
      const r = parseUnary();
      l = { k: 'bin', op, l, r, ...span(l, r) };
    }
    return l;
  }

  function parseUnary(): Node {
    if (isOp(peek(), '-')) {
      const tok = next();
      const arg = parseUnary();
      return { k: 'neg', arg, pos: tok.pos, end: arg.end };
    }
    if (isOp(peek(), '+')) {
      next();
      return parseUnary();
    }
    return parsePow();
  }

  function parsePow(): Node {
    const base = parsePrimary();
    if (isOp(peek(), '^')) {
      next();
      const exp = parseUnary();
      return { k: 'bin', op: '^', l: base, r: exp, ...span(base, exp) };
    }
    return base;
  }

  function parsePrimary(): Node {
    const tok = next();
    if (tok.kind === 'num') return { k: 'num', v: tok.value as number, pos: tok.pos, end: tok.end };
    if (tok.kind === 'str') return { k: 'str', v: tok.value as string, pos: tok.pos, end: tok.end };
    if (isOp(tok, '(')) {
      const e = parseOr();
      const close = expectOp(')');
      return { ...e, pos: tok.pos, end: close.end };
    }
    if (tok.kind === 'ident') {
      const lower = tok.text.toLowerCase();
      if (lower === 'true' || lower === 'false') return { k: 'bool', v: lower === 'true', pos: tok.pos, end: tok.end };
      if (lower === 'null') return { k: 'null', pos: tok.pos, end: tok.end };
      if (isOp(peek(), '(')) {
        next();
        const args: Node[] = [];
        if (!isOp(peek(), ')')) {
          args.push(parseOr());
          while (isOp(peek(), ',')) {
            next();
            args.push(parseOr());
          }
        }
        const close = expectOp(')');
        return { k: 'call', name: lower, nameSpan: { pos: tok.pos, end: tok.end }, args, pos: tok.pos, end: close.end };
      }
      if (KEYWORDS.has(lower)) throw new ExprError(`Unexpected keyword "${tok.text}"`, tok.pos, tok.end);
      return { k: 'ident', name: lower, pos: tok.pos, end: tok.end };
    }
    if (tok.kind === 'eof') throw new ExprError('Unexpected end of expression', tok.pos, tok.end);
    throw new ExprError(`Unexpected "${tok.text}"`, tok.pos, tok.end);
  }

  const root = parseOr();
  const rest = peek();
  if (rest.kind !== 'eof') throw new ExprError(`Unexpected "${rest.text}"`, rest.pos, rest.end);
  return root;
}
