import { describe, expect, it } from 'vitest';
import { applyFilter, compileFilter, compileNumber, ExprError, type CompileEnv } from '../src/lib/expr/compile';
import { parse } from '../src/lib/expr/parser';
import { baseRows } from '../src/lib/data/dataset';
import { loadRealData, rowOf } from './helpers';

const d = loadRealData();
const env: CompileEnv = { data: d, ctx: { maxTags: 20 } };
const cs = rowOf(d, 10); // Counter-Strike
const hl = rowOf(d, 70); // Half-Life

function where(src: string, e: CompileEnv = env) {
  const f = compileFilter(src, e);
  if (!f) throw new Error('empty');
  return f;
}

function errorOf(src: string, e: CompileEnv = env): ExprError {
  try {
    compileFilter(src, e);
  } catch (err) {
    if (err instanceof ExprError) return err;
    throw err;
  }
  throw new Error(`expected an error for: ${src}`);
}

describe('parser', () => {
  it('respects precedence', () => {
    const ast = parse('a or b and not c');
    expect(ast.k).toBe('bin');
    expect(ast.k === 'bin' && ast.op).toBe('or');
    expect(compileNumber('1 + 2 * 3 ^ 2', env)(0)).toBe(19);
    expect(compileNumber('-2 ^ 2', env)(0)).toBe(-4);
    expect(compileNumber('(1 + 2) * 3', env)(0)).toBe(9);
    expect(compileNumber('10 % 4', env)(0)).toBe(2);
  });

  it('reports positions', () => {
    const e = errorOf("reviews > 10 and name = 'x");
    expect(e.message).toMatch(/Unterminated/);
    expect(e.pos).toBe(24);
    expect(errorOf('reviews >').message).toMatch(/end of expression/);
    expect(errorOf('reviews > 5 5').pos).toBe(12);
  });
});

describe('compiler', () => {
  it('filters by numbers, strings and dates', () => {
    expect(where('reviews > 200000')(cs)).toBe(true);
    expect(where('reviews between 1 and 1000')(cs)).toBe(false);
    expect(where("name = 'Counter-Strike'")(cs)).toBe(true);
    expect(where("name like 'Counter%'")(cs)).toBe(true);
    expect(where("name like 'counter%'")(cs)).toBe(false);
    expect(where("name ilike 'counter%'")(cs)).toBe(true);
    expect(where("name not ilike '%strike'")(cs)).toBe(false);
    expect(where("release_date < '2001-01-01'")(cs)).toBe(true);
    expect(where("release_date between '2000' and '2000-12-31'")(cs)).toBe(true);
    expect(where('year(release_date) = 2000 and month(release_date) = 11')(cs)).toBe(true);
    expect(where("name in ('Half-Life', 'Portal')")(hl)).toBe(true);
    expect(where('appid in (10, 20)')(cs)).toBe(true);
    expect(where('appid not in (10, 20)')(cs)).toBe(false);
    expect(where('not is_free and rating > 90')(cs)).toBe(true);
    expect(where('is_free = false')(cs)).toBe(true);
  });

  it('handles tag and genre lists', () => {
    expect(where("tags has 'fps'")(cs)).toBe(true);
    expect(where("'FPS' in tags")(cs)).toBe(true);
    expect(where("tags not has 'FPS'")(cs)).toBe(false);
    expect(where("has_any(tags, 'Roguelike', 'Shooter')")(cs)).toBe(true);
    expect(where("has_all(tags, 'Roguelike', 'Shooter')")(cs)).toBe(false);
    expect(where("genres has 'Action'")(cs)).toBe(true);
    expect(where("pos(tags, 'FPS') = 2")(cs)).toBe(true);
    expect(where('len(tags) = 20')(cs)).toBe(true);
    // maxTags limits what the tags column sees.
    const short: CompileEnv = { data: d, ctx: { maxTags: 2 } };
    expect(where("tags has 'Multiplayer'", short)(cs)).toBe(false);
    expect(where('len(tags) = 2', short)(cs)).toBe(true);
  });

  it('treats nulls like SQL comparisons', () => {
    const cod = rowOf(d, 1938090); // no price
    expect(where('price > 0')(cod)).toBe(false);
    expect(where('price <= 0')(cod)).toBe(false);
    expect(where('price != 5')(cod)).toBe(false);
    expect(where('price is null')(cod)).toBe(true);
    expect(where('revenue is not null')(cs)).toBe(true);
    expect(compileNumber('coalesce(revenue, 0)', env)(cod)).toBe(0);
  });

  it('evaluates numeric formulas with variables', () => {
    const f = compileNumber('if(x > 100, log10(x + 1), 0) + min(x, 5)', {
      ...env,
      vars: { x: { f: () => 999, description: 'test' } },
    });
    expect(f(0)).toBeCloseTo(3 + 5);
    expect(compileNumber('reviews > 1000', env)(cs)).toBe(1);
    expect(compileNumber('clamp(reviews, 0, 10)', env)(cs)).toBe(10);
    expect(compileNumber('round(rating, 1)', env)(cs)).toBeCloseTo(97.4);
  });

  it('gives helpful errors', () => {
    expect(errorOf("tags has 'Rogue-like'").message).toMatch(/did you mean "Roguelike"/);
    expect(errorOf('revews > 10').message).toMatch(/did you mean "reviews"/);
    expect(errorOf('reveiws > 10').message).toMatch(/did you mean "reviews"/);
    expect(errorOf('sqr(reviews) > 1').message).toMatch(/did you mean "sqrt"/);
    expect(errorOf('roguelike').message).toMatch(/tags has 'roguelike'/);
    expect(errorOf('reviews + 1').message).toMatch(/must be true\/false/);
    expect(errorOf("tags = 'FPS'").message).toMatch(/use HAS/);
    expect(errorOf('price = null').message).toMatch(/IS NULL/);
    expect(errorOf("release_date > '2020-13-01'").message).toMatch(/Invalid date/);
    expect(errorOf("name > 5").message).toMatch(/Can't compare/);
    const e = errorOf("reviews > 5 and tags has 'Nope nope'");
    expect(e.pos).toBe(25);
    expect(e.end).toBe(36);
  });

  it('returns null for an empty filter and filters rows', () => {
    expect(compileFilter('   ', env)).toBeNull();
    const rows = applyFilter(baseRows(d, true), where("tags has 'Roguelike' and reviews > 1000"));
    expect(rows.length).toBeGreaterThan(100);
    for (const i of rows.subarray(0, 50)) expect(d.total[i]).toBeGreaterThan(1000);
  });
});
