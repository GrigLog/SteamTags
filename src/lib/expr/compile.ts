// Type-checks an expression AST and compiles it into a closure over the game columns.
// Nulls are NaN for numbers and dates; any comparison involving a null is false.

import {
  COLUMNS,
  COLUMN_BY_ID,
  listAccessor,
  numAccessor,
  strAccessor,
  type ColumnCtx,
  type ListAccess,
} from '../data/columns';
import { isoToDay, type GameData } from '../data/dataset';
import { ExprError, parse, type Node } from './parser';

type Fn<T> = (i: number) => T;

type Compiled =
  | { t: 'num'; f: Fn<number>; c?: number }
  | { t: 'date'; f: Fn<number>; c?: number }
  | { t: 'str'; f: Fn<string>; c?: string }
  | { t: 'bool'; f: Fn<boolean>; c?: boolean }
  | { t: 'list'; list: ListAccess }
  | { t: 'null' };

export interface CompileEnv {
  data: GameData;
  ctx: ColumnCtx;
  /** Extra numeric variables, e.g. `x` in utility formulas. */
  vars?: Record<string, { f: Fn<number>; description: string }>;
}

const TYPE_NAMES: Record<Compiled['t'], string> = {
  num: 'a number',
  date: 'a date',
  str: 'a string',
  bool: 'a condition',
  list: 'a list',
  null: 'NULL',
};

// ---------------------------------------------------------------------------
// Suggestions

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function suggest(word: string, candidates: string[]): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_'’.]/g, '');
  const w = norm(word);
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    const cn = norm(c);
    const d = cn === w ? 0 : cn.startsWith(w) || w.startsWith(cn) ? 1 : levenshtein(w, cn);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= Math.max(2, Math.floor(w.length / 3)) ? best : undefined;
}

const didYouMean = (s: string | undefined) => (s ? ` — did you mean "${s}"?` : '');

// ---------------------------------------------------------------------------
// Functions

interface FnSpec {
  signature: string;
  description: string;
}

export const FUNCTIONS: Record<string, FnSpec> = {
  has: { signature: "has(list, 'Name')", description: 'List contains the tag/genre (same as list HAS name)' },
  has_any: { signature: "has_any(list, 'A', 'B', …)", description: 'List contains at least one of the names' },
  has_all: { signature: "has_all(list, 'A', 'B', …)", description: 'List contains all of the names' },
  pos: { signature: "pos(tags, 'Name')", description: '1-based position in the list, null if absent' },
  len: { signature: 'len(x)', description: 'Length of a string or number of items in a list' },
  lower: { signature: 'lower(s)', description: 'Lower-case string' },
  upper: { signature: 'upper(s)', description: 'Upper-case string' },
  year: { signature: 'year(date)', description: 'Year of a date' },
  month: { signature: 'month(date)', description: 'Month of a date, 1–12' },
  date: { signature: "date('YYYY-MM-DD')", description: 'Date literal' },
  if: { signature: 'if(cond, a, b)', description: 'a when cond is true, otherwise b' },
  coalesce: { signature: 'coalesce(a, b, …)', description: 'First non-null number' },
  abs: { signature: 'abs(x)', description: 'Absolute value' },
  sqrt: { signature: 'sqrt(x)', description: 'Square root' },
  ln: { signature: 'ln(x)', description: 'Natural logarithm' },
  log10: { signature: 'log10(x)', description: 'Base-10 logarithm' },
  log2: { signature: 'log2(x)', description: 'Base-2 logarithm' },
  exp: { signature: 'exp(x)', description: 'e^x' },
  pow: { signature: 'pow(x, y)', description: 'x^y' },
  min: { signature: 'min(a, b, …)', description: 'Smallest value' },
  max: { signature: 'max(a, b, …)', description: 'Largest value' },
  clamp: { signature: 'clamp(x, lo, hi)', description: 'x limited to [lo, hi]' },
  floor: { signature: 'floor(x)', description: 'Round down' },
  ceil: { signature: 'ceil(x)', description: 'Round up' },
  round: { signature: 'round(x[, digits])', description: 'Round to digits after the point' },
  sign: { signature: 'sign(x)', description: '-1, 0 or 1' },
};

const MATH1: Record<string, (x: number) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
};

// ---------------------------------------------------------------------------
// Compiler

function isNumeric(c: Compiled): c is Extract<Compiled, { t: 'num' | 'date' }> {
  return c.t === 'num' || c.t === 'date';
}

function constNum(v: number): Compiled {
  return { t: 'num', f: () => v, c: v };
}

class Compiler {
  private listNameIndex = new Map<ListAccess['kind'], Map<string, number>>();

  constructor(private env: CompileEnv) {}

  err(node: { pos: number; end: number }, msg: string): never {
    throw new ExprError(msg, node.pos, node.end);
  }

  expect<T extends Compiled['t']>(node: Node, c: Compiled, ...types: T[]): Extract<Compiled, { t: T }> {
    if (!(types as string[]).includes(c.t)) {
      const want = types.map((t) => TYPE_NAMES[t]).join(' or ');
      this.err(node, `Expected ${want}, got ${TYPE_NAMES[c.t]}`);
    }
    return c as Extract<Compiled, { t: T }>;
  }

  num(node: Node): Extract<Compiled, { t: 'num' | 'date' }> {
    const c = this.compile(node);
    if (c.t === 'bool') return { t: 'num', f: (i) => (c.f(i) ? 1 : 0) };
    return this.expect(node, c, 'num', 'date');
  }

  bool(node: Node): Fn<boolean> {
    return this.expect(node, this.compile(node), 'bool').f;
  }

  listItemId(list: ListAccess, node: Node): number {
    const c = this.compile(node);
    if (c.t !== 'str' || c.c === undefined) this.err(node, `Expected a ${list.kind} name in quotes, e.g. 'Roguelike'`);
    let index = this.listNameIndex.get(list.kind);
    if (!index) {
      index = new Map(list.names.map((name, id) => [name.toLowerCase(), id]));
      this.listNameIndex.set(list.kind, index);
    }
    const id = index.get(c.c.toLowerCase());
    if (id === undefined) this.err(node, `Unknown ${list.kind} "${c.c}"${didYouMean(suggest(c.c, list.names))}`);
    return id;
  }

  /** Number-or-date operand for comparison with another operand; string literals become dates. */
  comparable(node: Node, c: Compiled, other: Compiled): Compiled {
    if (c.t === 'str' && other.t === 'date') {
      if (c.c === undefined) this.err(node, 'Dates can only be compared with literals like \'2020-01-31\'');
      const day = isoToDay(c.c);
      if (Number.isNaN(day)) this.err(node, `Invalid date "${c.c}", use 'YYYY-MM-DD'`);
      return { t: 'date', f: () => day, c: day };
    }
    return c;
  }

  compare(node: Node, op: string, ln: Node, rn: Node): Compiled {
    let l = this.compile(ln);
    let r = this.compile(rn);
    if (l.t === 'null' || r.t === 'null') this.err(node, 'Use IS NULL / IS NOT NULL to test for nulls');
    l = this.comparable(ln, l, r);
    r = this.comparable(rn, r, l);
    if (isNumeric(l) && isNumeric(r)) {
      const a = l.f;
      const b = r.f;
      switch (op) {
        case '=': return { t: 'bool', f: (i) => a(i) === b(i) };
        case '!=': return { t: 'bool', f: (i) => { const x = a(i), y = b(i); return x === x && y === y && x !== y; } };
        case '<': return { t: 'bool', f: (i) => a(i) < b(i) };
        case '<=': return { t: 'bool', f: (i) => a(i) <= b(i) };
        case '>': return { t: 'bool', f: (i) => a(i) > b(i) };
        case '>=': return { t: 'bool', f: (i) => a(i) >= b(i) };
      }
    }
    if (l.t === 'str' && r.t === 'str') {
      const a = l.f;
      const b = r.f;
      switch (op) {
        case '=': return { t: 'bool', f: (i) => a(i) === b(i) };
        case '!=': return { t: 'bool', f: (i) => a(i) !== b(i) };
        case '<': return { t: 'bool', f: (i) => a(i) < b(i) };
        case '<=': return { t: 'bool', f: (i) => a(i) <= b(i) };
        case '>': return { t: 'bool', f: (i) => a(i) > b(i) };
        case '>=': return { t: 'bool', f: (i) => a(i) >= b(i) };
      }
    }
    if (l.t === 'bool' && r.t === 'bool' && (op === '=' || op === '!=')) {
      const a = l.f;
      const b = r.f;
      return op === '=' ? { t: 'bool', f: (i) => a(i) === b(i) } : { t: 'bool', f: (i) => a(i) !== b(i) };
    }
    if (l.t === 'list' || r.t === 'list') {
      const listNode = l.t === 'list' ? ln : rn;
      this.err(listNode, `Lists can't be compared with "${op}"; use HAS, e.g. tags has 'Roguelike'`);
    }
    return this.err(node, `Can't compare ${TYPE_NAMES[l.t]} with ${TYPE_NAMES[r.t]} using "${op}"`);
  }

  compile(node: Node): Compiled {
    switch (node.k) {
      case 'num': return constNum(node.v);
      case 'str': return { t: 'str', f: () => node.v, c: node.v };
      case 'bool': return { t: 'bool', f: () => node.v, c: node.v };
      case 'null': return { t: 'null' };
      case 'ident': return this.ident(node);
      case 'neg': {
        const a = this.num(node.arg).f;
        return { t: 'num', f: (i) => -a(i) };
      }
      case 'not': {
        const a = this.bool(node.arg);
        return { t: 'bool', f: (i) => !a(i) };
      }
      case 'bin': {
        const { op } = node;
        if (op === 'and' || op === 'or') {
          const a = this.bool(node.l);
          const b = this.bool(node.r);
          return op === 'and' ? { t: 'bool', f: (i) => a(i) && b(i) } : { t: 'bool', f: (i) => a(i) || b(i) };
        }
        if (op === '=' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
          return this.compare(node, op, node.l, node.r);
        }
        const a = this.num(node.l).f;
        const b = this.num(node.r).f;
        switch (op) {
          case '+': return { t: 'num', f: (i) => a(i) + b(i) };
          case '-': return { t: 'num', f: (i) => a(i) - b(i) };
          case '*': return { t: 'num', f: (i) => a(i) * b(i) };
          case '/': return { t: 'num', f: (i) => a(i) / b(i) };
          case '%': return { t: 'num', f: (i) => a(i) % b(i) };
          case '^': return { t: 'num', f: (i) => a(i) ** b(i) };
        }
        return this.err(node, `Unknown operator ${op}`);
      }
      case 'like': {
        const l = this.expect(node.l, this.compile(node.l), 'str');
        const r = this.expect(node.r, this.compile(node.r), 'str');
        const toRe = (pattern: string) => {
          const body = pattern.replace(/[.*+?^${}()|[\]\\%_]/g, (ch) => (ch === '%' ? '.*' : ch === '_' ? '.' : '\\' + ch));
          return new RegExp(`^${body}$`, node.ci ? 'is' : 's');
        };
        const get = l.f;
        const neg = node.neg;
        if (r.c !== undefined) {
          const re = toRe(r.c);
          return { t: 'bool', f: (i) => re.test(get(i)) !== neg };
        }
        const pat = r.f;
        let lastPat = '';
        let lastRe = toRe('');
        return {
          t: 'bool',
          f: (i) => {
            const p = pat(i);
            if (p !== lastPat) {
              lastPat = p;
              lastRe = toRe(p);
            }
            return lastRe.test(get(i)) !== neg;
          },
        };
      }
      case 'in': {
        const l = this.compile(node.l);
        if (l.t === 'list') this.err(node.l, "Use HAS for lists, e.g. tags has 'Roguelike'");
        const items = node.items.map((it) => {
          const c = this.comparable(it, this.compile(it), l);
          if (c.t === 'null') this.err(it, 'NULL is not allowed in IN (…)');
          return c;
        });
        const neg = node.neg;
        if (isNumeric(l)) {
          const get = l.f;
          items.forEach((c, k) => this.expect(node.items[k], c, 'num', 'date'));
          if (items.every((c) => 'c' in c && c.c !== undefined)) {
            const set = new Set(items.map((c) => (c as { c: number }).c));
            return { t: 'bool', f: (i) => { const v = get(i); return v === v && set.has(v) !== neg; } };
          }
          const fs = items.map((c) => (c as { f: Fn<number> }).f);
          return { t: 'bool', f: (i) => { const v = get(i); return v === v && fs.some((g) => g(i) === v) !== neg; } };
        }
        if (l.t === 'str') {
          const get = l.f;
          items.forEach((c, k) => this.expect(node.items[k], c, 'str'));
          const fs = items.map((c) => (c as { f: Fn<string> }).f);
          if (items.every((c) => (c as { c?: string }).c !== undefined)) {
            const set = new Set(items.map((c) => (c as { c: string }).c));
            return { t: 'bool', f: (i) => set.has(get(i)) !== neg };
          }
          return { t: 'bool', f: (i) => { const v = get(i); return fs.some((g) => g(i) === v) !== neg; } };
        }
        return this.err(node.l, `IN needs a number, date or string on the left, got ${TYPE_NAMES[l.t]}`);
      }
      case 'between': {
        let v = this.compile(node.l);
        let lo = this.compile(node.lo);
        let hi = this.compile(node.hi);
        lo = this.comparable(node.lo, lo, v);
        hi = this.comparable(node.hi, hi, v);
        const neg = node.neg;
        if (isNumeric(v)) {
          const g = v.f;
          const a = this.expect(node.lo, lo, 'num', 'date').f;
          const b = this.expect(node.hi, hi, 'num', 'date').f;
          return { t: 'bool', f: (i) => { const x = g(i); return x === x && (x >= a(i) && x <= b(i)) !== neg; } };
        }
        v = this.expect(node.l, v, 'str');
        const g = v.f;
        const a = this.expect(node.lo, lo, 'str').f;
        const b = this.expect(node.hi, hi, 'str').f;
        return { t: 'bool', f: (i) => { const x = g(i); return (x >= a(i) && x <= b(i)) !== neg; } };
      }
      case 'isnull': {
        const c = this.compile(node.arg);
        const neg = node.neg;
        switch (c.t) {
          case 'num':
          case 'date': {
            const g = c.f;
            return { t: 'bool', f: (i) => { const v = g(i); return (v !== v) !== neg; } };
          }
          case 'str': {
            const g = c.f;
            return { t: 'bool', f: (i) => (g(i) === '') !== neg };
          }
          case 'list': {
            const { start, end } = c.list;
            return { t: 'bool', f: (i) => (end(i) <= start(i)) !== neg };
          }
          case 'null': return { t: 'bool', f: () => !neg, c: !neg };
          default: return { t: 'bool', f: () => neg, c: neg };
        }
      }
      case 'has': {
        const list = this.expect(node.list, this.compile(node.list), 'list').list;
        const id = this.listItemId(list, node.item);
        return this.hasAny(list, [id], node.neg);
      }
      case 'call': return this.call(node);
    }
  }

  hasAny(list: ListAccess, wanted: number[], neg: boolean): Compiled {
    const { ids, start, end } = list;
    if (wanted.length === 1) {
      const w = wanted[0];
      return {
        t: 'bool',
        f: (i) => {
          for (let k = start(i), e = end(i); k < e; k++) if (ids[k] === w) return !neg;
          return neg;
        },
      };
    }
    const set = new Set(wanted);
    return {
      t: 'bool',
      f: (i) => {
        for (let k = start(i), e = end(i); k < e; k++) if (set.has(ids[k])) return !neg;
        return neg;
      },
    };
  }

  ident(node: Extract<Node, { k: 'ident' }>): Compiled {
    const v = this.env.vars?.[node.name];
    if (v) return { t: 'num', f: v.f };
    const col = COLUMN_BY_ID.get(node.name);
    if (!col) {
      const names = [...COLUMNS.map((c) => c.id), ...Object.keys(this.env.vars ?? {})];
      const extra = this.env.data.tagNames.some((t) => t.toLowerCase() === node.name) ? `. To test a tag, use tags has '${node.name}'` : '';
      return this.err(node, `Unknown column "${node.name}"${didYouMean(suggest(node.name, names))}${extra}`);
    }
    const d = this.env.data;
    switch (col.type) {
      case 'str': return { t: 'str', f: strAccessor(d, col.id) };
      case 'list': return { t: 'list', list: listAccessor(d, col.id, this.env.ctx) };
      case 'bool': {
        const g = numAccessor(d, col.id);
        return { t: 'bool', f: (i) => g(i) !== 0 };
      }
      case 'date': return { t: 'date', f: numAccessor(d, col.id) };
      default: return { t: 'num', f: numAccessor(d, col.id) };
    }
  }

  call(node: Extract<Node, { k: 'call' }>): Compiled {
    const { name, args } = node;
    const spec = FUNCTIONS[name];
    if (!spec) {
      return this.err(node.nameSpan, `Unknown function "${name}"${didYouMean(suggest(name, Object.keys(FUNCTIONS)))}`);
    }
    const arity = (min: number, max = min) => {
      if (args.length < min || args.length > max) this.err(node, `${spec.signature} takes ${min === max ? min : `${min}–${max === Infinity ? 'many' : max}`} argument${max === 1 ? '' : 's'}`);
    };

    if (name in MATH1) {
      arity(1);
      const f = MATH1[name];
      const a = this.num(args[0]).f;
      return { t: 'num', f: (i) => f(a(i)) };
    }
    switch (name) {
      case 'has':
      case 'has_any':
      case 'has_all': {
        arity(2, Infinity);
        const list = this.expect(args[0], this.compile(args[0]), 'list').list;
        const wanted = args.slice(1).map((a) => this.listItemId(list, a));
        if (name !== 'has_all') return this.hasAny(list, wanted, false);
        const { ids, start, end } = list;
        return {
          t: 'bool',
          f: (i) => {
            const s = start(i), e = end(i);
            outer: for (const w of wanted) {
              for (let k = s; k < e; k++) if (ids[k] === w) continue outer;
              return false;
            }
            return true;
          },
        };
      }
      case 'pos': {
        arity(2);
        const list = this.expect(args[0], this.compile(args[0]), 'list').list;
        const w = this.listItemId(list, args[1]);
        const { ids, start, end } = list;
        return {
          t: 'num',
          f: (i) => {
            const s = start(i);
            for (let k = s, e = end(i); k < e; k++) if (ids[k] === w) return k - s + 1;
            return NaN;
          },
        };
      }
      case 'len': {
        arity(1);
        const c = this.expect(args[0], this.compile(args[0]), 'str', 'list');
        if (c.t === 'str') {
          const g = c.f;
          return { t: 'num', f: (i) => g(i).length };
        }
        const { start, end } = c.list;
        return { t: 'num', f: (i) => end(i) - start(i) };
      }
      case 'lower':
      case 'upper': {
        arity(1);
        const g = this.expect(args[0], this.compile(args[0]), 'str').f;
        return name === 'lower' ? { t: 'str', f: (i) => g(i).toLowerCase() } : { t: 'str', f: (i) => g(i).toUpperCase() };
      }
      case 'year':
      case 'month': {
        arity(1);
        const g = this.expect(args[0], this.compile(args[0]), 'date').f;
        return {
          t: 'num',
          f: (i) => {
            const v = g(i);
            if (v !== v) return NaN;
            const dt = new Date(v * 86_400_000);
            return name === 'year' ? dt.getUTCFullYear() : dt.getUTCMonth() + 1;
          },
        };
      }
      case 'date': {
        arity(1);
        const c = this.compile(args[0]);
        if (c.t !== 'str' || c.c === undefined) this.err(args[0], "date() expects a literal like '2020-01-31'");
        const day = isoToDay(c.c);
        if (Number.isNaN(day)) this.err(args[0], `Invalid date "${c.c}", use 'YYYY-MM-DD'`);
        return { t: 'date', f: () => day, c: day };
      }
      case 'if': {
        arity(3);
        const cond = this.bool(args[0]);
        const a = this.compile(args[1]);
        const b = this.compile(args[2]);
        if (a.t === 'str' && b.t === 'str') {
          const fa = a.f, fb = b.f;
          return { t: 'str', f: (i) => (cond(i) ? fa(i) : fb(i)) };
        }
        if (a.t === 'bool' && b.t === 'bool') {
          const fa = a.f, fb = b.f;
          return { t: 'bool', f: (i) => (cond(i) ? fa(i) : fb(i)) };
        }
        const fa = a.t === 'null' ? () => NaN : this.num(args[1]).f;
        const fb = b.t === 'null' ? () => NaN : this.num(args[2]).f;
        return { t: 'num', f: (i) => (cond(i) ? fa(i) : fb(i)) };
      }
      case 'coalesce': {
        arity(1, Infinity);
        const fs = args.map((a) => this.num(a).f);
        return {
          t: 'num',
          f: (i) => {
            for (const g of fs) {
              const v = g(i);
              if (v === v) return v;
            }
            return NaN;
          },
        };
      }
      case 'pow': {
        arity(2);
        const a = this.num(args[0]).f, b = this.num(args[1]).f;
        return { t: 'num', f: (i) => a(i) ** b(i) };
      }
      case 'min':
      case 'max': {
        arity(1, Infinity);
        const fs = args.map((a) => this.num(a).f);
        const pick = name === 'min' ? Math.min : Math.max;
        if (fs.length === 2) {
          const [a, b] = fs;
          return { t: 'num', f: (i) => pick(a(i), b(i)) };
        }
        return { t: 'num', f: (i) => pick(...fs.map((g) => g(i))) };
      }
      case 'clamp': {
        arity(3);
        const x = this.num(args[0]).f, lo = this.num(args[1]).f, hi = this.num(args[2]).f;
        return { t: 'num', f: (i) => Math.min(Math.max(x(i), lo(i)), hi(i)) };
      }
      case 'round': {
        arity(1, 2);
        const x = this.num(args[0]).f;
        if (args.length === 1) return { t: 'num', f: (i) => Math.round(x(i)) };
        const dg = this.num(args[1]).f;
        return { t: 'num', f: (i) => { const m = 10 ** dg(i); return Math.round(x(i) * m) / m; } };
      }
    }
    return this.err(node, `Function "${name}" is not implemented`);
  }
}

/** Compiles a filter condition. Returns null for an empty condition (no filtering). */
export function compileFilter(src: string, env: CompileEnv): Fn<boolean> | null {
  if (!src.trim()) return null;
  const ast = parse(src);
  const c = new Compiler(env);
  const res = c.compile(ast);
  if (res.t !== 'bool') throw new ExprError(`The condition must be true/false, got ${TYPE_NAMES[res.t]}`, ast.pos, ast.end);
  return res.f;
}

/** Compiles a numeric formula; conditions evaluate to 1/0 and nulls to NaN. */
export function compileNumber(src: string, env: CompileEnv): Fn<number> {
  if (!src.trim()) throw new ExprError('The formula is empty', 0, 0);
  const ast = parse(src);
  const c = new Compiler(env);
  return c.num(ast).f;
}

/** Row indices from `rows` that satisfy `filter` (all rows when filter is null). */
export function applyFilter(rows: Uint32Array, filter: Fn<boolean> | null): Uint32Array {
  if (!filter) return rows;
  const out = new Uint32Array(rows.length);
  let m = 0;
  for (let k = 0; k < rows.length; k++) {
    const i = rows[k];
    if (filter(i)) out[m++] = i;
  }
  return out.slice(0, m);
}

export { ExprError };
