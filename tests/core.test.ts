import { describe, expect, it } from 'vitest';
import { analyse, supertarget } from '../src/core/analyse';
import { EXAMPLES } from '../src/examples';
import { annualisationFactor } from '../src/core/costs';
import { compileExpression } from '../src/core/expression';
import { parseFile, serialise, toFile, emptyProject, newStream } from '../src/core/project';
import type { Project, Utility } from '../src/core/types';

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

describe('published benchmark cases', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.title}: energy targets and pinch`, () => {
      const p = ex.build();
      const a = analyse(p, ex.published.dtMin);
      close(a.pt.qhMin, ex.published.qh);
      close(a.pt.qcMin, ex.published.qc);
      expect(a.pt.pinches).toHaveLength(1);
      const shifted = a.pt.pinches[0];
      close(shifted + ex.published.dtMin / 2, ex.published.hotPinch);
      close(shifted - ex.published.dtMin / 2, ex.published.coldPinch);
      expect(a.pt.threshold).toBe(false);
      // utilities meet the whole demand
      close(a.utilityTargets.filter((u) => u.kind === 'hot').reduce((s, u) => s + u.duty, 0), ex.published.qh);
      close(a.utilityTargets.filter((u) => u.kind === 'cold').reduce((s, u) => s + u.duty, 0), ex.published.qc);
      expect(a.unmetHot).toBe(0);
      expect(a.unmetCold).toBe(0);
    });
  }

  it('Kemp four-stream: Problem Table interval balances', () => {
    const a = analyse(EXAMPLES[0].build(), 10);
    expect(a.pt.boundaries).toEqual([165, 145, 140, 85, 55, 25]);
    a.pt.intervals.map((iv) => iv.dH).forEach((d, i) => close(d, [60, 2.5, -82.5, 75, -15][i]));
    a.pt.feasible.forEach((q, i) => close(q, [20, 80, 82.5, 0, 75, 60][i]));
  });

  it('Kemp four-stream: minimum units (overall 5, MER 7)', () => {
    const a = analyse(EXAMPLES[0].build(), 10);
    expect(a.units.overall).toBe(5);
    expect(a.units.mer).toBe(7);
  });

  it('composite curves end at the right enthalpies and touch at ΔTmin', () => {
    const a = analyse(EXAMPLES[0].build(), 10);
    const hot = a.composites.hot;
    const cold = a.composites.cold;
    close(hot[hot.length - 1].h, 330 + 180);
    close(cold[0].h, 60);
    close(cold[cold.length - 1].h, 60 + 230 + 240);
    // shifted curves touch at the pinch (shifted 85 °C)
    const sh = a.shiftedComposites;
    const at = (pts: { h: number; t: number }[], t: number) => {
      for (let i = 1; i < pts.length; i++)
        if (t >= pts[i - 1].t && t <= pts[i].t) return pts[i - 1].h + ((pts[i].h - pts[i - 1].h) * (t - pts[i - 1].t)) / (pts[i].t - pts[i - 1].t);
      return NaN;
    };
    close(at(sh.hot, 85), at(sh.cold, 85));
  });

  it('GCC is zero at the pinch and equals QH / QC at the ends', () => {
    const a = analyse(EXAMPLES[2].build(), 10);
    close(a.gcc[0].h, 750);
    close(a.gcc[a.gcc.length - 1].h, 1000);
    expect(a.gcc.find((p) => Math.abs(p.t - 145) < 1e-9)!.h).toBe(0);
  });
});

describe('multiple utilities on the GCC', () => {
  const withUtils = (utilities: Utility[]): Project => ({ ...EXAMPLES[0].build(), utilities });

  it('splits hot utility between LP and HP steam', () => {
    const a = analyse(
      withUtils([
        { id: 'hp', name: 'HP', kind: 'hot', tSupply: 180, tTarget: 180, cost: 150 },
        { id: 'lp', name: 'LP', kind: 'hot', tSupply: 100, tTarget: 100, cost: 80 },
        { id: 'cw', name: 'CW', kind: 'cold', tSupply: 10, tTarget: 20, cost: 10 },
      ]),
      10,
    );
    const d = Object.fromEntries(a.utilityTargets.map((u) => [u.id, u.duty]));
    close(d.lp, 15);
    close(d.hp, 5);
    close(d.cw, 60);
    close(a.cost.operating, 15 * 80 + 5 * 150 + 60 * 10);
  });

  it('splits cold utility between a warm level and cooling water', () => {
    const a = analyse(
      withUtils([
        { id: 'hp', name: 'HP', kind: 'hot', tSupply: 180, tTarget: 180, cost: 150 },
        { id: 'bfw', name: 'Warm sink', kind: 'cold', tSupply: 65, tTarget: 65, cost: -5 },
        { id: 'cw', name: 'CW', kind: 'cold', tSupply: 10, tTarget: 20, cost: 10 },
      ]),
      10,
    );
    const d = Object.fromEntries(a.utilityTargets.map((u) => [u.id, u.duty]));
    close(d.bfw, 37.5, 1e-5);
    close(d.cw, 22.5, 1e-5);
  });

  it('non-isothermal hot oil is placed against the GCC', () => {
    const a = analyse(
      withUtils([
        { id: 'oil', name: 'Hot oil', kind: 'hot', tSupply: 200, tTarget: 100, cost: 90 },
        { id: 'cw', name: 'CW', kind: 'cold', tSupply: 10, tTarget: 20, cost: 10 },
      ]),
      10,
    );
    close(a.utilityTargets[0].duty, 20, 1e-5);
  });

  it('reports unmet demand when utilities are too cold', () => {
    const a = analyse(
      withUtils([
        { id: 'lp', name: 'LP', kind: 'hot', tSupply: 100, tTarget: 100, cost: 80 },
        { id: 'cw', name: 'CW', kind: 'cold', tSupply: 10, tTarget: 20, cost: 10 },
      ]),
      10,
    );
    close(a.utilityTargets[0].duty, 15, 1e-5);
    close(a.unmetHot, 5, 1e-5);
    expect(a.issues.some((i) => i.message.includes('hotter utility'))).toBe(true);
  });
});

describe('area target (Bath formula)', () => {
  const twoStream = (hot: [number, number, number], cold: [number, number, number]): Project => ({
    ...emptyProject(),
    utilities: [
      { id: 'st', name: 'Steam', kind: 'hot', tSupply: 300, tTarget: 300, cost: 100, h: 1 },
      { id: 'cw', name: 'CW', kind: 'cold', tSupply: 5, tTarget: 6, cost: 10, h: 1 },
    ],
    streams: [
      newStream({ id: 'h', name: 'H', tSupply: hot[0], tTarget: hot[1], cp: hot[2], h: 1 }),
      newStream({ id: 'c', name: 'C', tSupply: cold[0], tTarget: cold[1], cp: cold[2], h: 1 }),
    ],
  });

  it('equal CPs, constant ΔT = 10 K: A = Q/(U·ΔT) = 20 m²', () => {
    const a = analyse(twoStream([150, 50, 1], [40, 140, 1]), 10);
    close(a.pt.qhMin, 0);
    close(a.pt.qcMin, 0);
    close(a.area.total!, 100 / (0.5 * 10));
  });

  it('counter-current exchanger: A = Q/(U·LMTD)', () => {
    const a = analyse(twoStream([200, 100, 1], [50, 100, 2]), 10);
    const lmtd = (100 - 50) / Math.log(100 / 50);
    close(a.area.total!, 100 / (0.5 * lmtd));
  });

  it('reports missing film coefficients instead of a number', () => {
    const p = EXAMPLES[0].build();
    p.streams[0].h = undefined;
    const a = analyse(p);
    expect(a.area.total).toBeNull();
    expect(a.area.missingH).toContain('s1');
    expect(Number.isNaN(a.cost.total)).toBe(true);
  });
});

describe('costs', () => {
  it('annualisation factor', () => {
    close(annualisationFactor(0.1, 5), 0.263797, 1e-5);
    close(annualisationFactor(0, 4), 0.25);
  });

  it('custom expression equals the power law', () => {
    const f = compileExpression('10000 + 800*A^0.8');
    close(f(100), 10000 + 800 * Math.pow(100, 0.8));
    expect(compileExpression('-2^2')(0)).toBe(-4);
    expect(compileExpression('max(1, sqrt(A))')(16)).toBe(4);
    expect(() => compileExpression('10000 + B')).toThrow();
  });

  it('total cost = operating + annualised capital', () => {
    const p = EXAMPLES[0].build();
    const a = analyse(p);
    const { area, units, cost } = a;
    const n = units.mer;
    const cap = n * (10000 + 800 * Math.pow(area.total! / n, 0.8));
    close(cost.capital, cap);
    close(cost.total, 20 * 120 + 60 * 10 + cap * annualisationFactor(0.1, 5));
  });

  it('all capital models give finite costs', () => {
    const p = EXAMPLES[2].build();
    const models: Project['economics']['capital'][] = [
      { kind: 'linear', a: 5000, b: 500 },
      { kind: 'separate', exchanger: { a: 10000, b: 800, c: 0.8 }, heater: { a: 12000, b: 900, c: 0.8 }, cooler: { a: 8000, b: 700, c: 0.8 } },
      { kind: 'custom', expression: '8000 + 600*A^0.85' },
    ];
    for (const m of models) {
      const a = analyse({ ...p, economics: { ...p.economics, capital: m } });
      expect(Number.isFinite(a.cost.total)).toBe(true);
    }
  });
});

describe('supertargeting', () => {
  it('finds an optimum ΔTmin inside the range', () => {
    const p = EXAMPLES[2].build();
    const st = supertarget(p);
    expect(st.points).toHaveLength(80);
    expect(st.optimum).toBeDefined();
    // energy targets rise with ΔTmin
    expect(st.points[st.points.length - 1].qh).toBeGreaterThan(st.points[0].qh);
  });
});

describe('edge cases', () => {
  it('threshold problem: only hot streams', () => {
    const p = { ...emptyProject(), streams: [newStream({ name: 'H', tSupply: 100, tTarget: 40, cp: 2, h: 1 })] };
    const a = analyse(p);
    close(a.pt.qhMin, 0);
    close(a.pt.qcMin, 120);
    expect(a.pt.threshold).toBe(true);
  });

  it('duty-specified streams derive CP', () => {
    const p = { ...emptyProject(), streams: [newStream({ name: 'H', tSupply: 100, tTarget: 40, spec: 'duty', duty: 120 })] };
    expect(analyse(p).streams[0].cp).toBe(2);
  });

  it('individual ΔT contributions shift each stream separately', () => {
    const p = EXAMPLES[0].build();
    p.streams[1].dtCont = 10; // Hot 2 shifts 10 K instead of 5
    const a = analyse(p, 10);
    expect(a.streams.find((s) => s.id === 's2')!.sTs).toBe(160);
    expect(a.pt.qhMin).toBeGreaterThan(20);
  });

  it('invalid streams are reported and skipped', () => {
    const p = { ...emptyProject(), streams: [newStream({ name: 'Bad', tSupply: 50, tTarget: 50, cp: 1 })] };
    const a = analyse(p);
    expect(a.streams).toHaveLength(0);
    expect(a.issues[0].level).toBe('error');
  });
});

describe('.pinch file format', () => {
  it('round-trips, including blank numbers', () => {
    const p = EXAMPLES[1].build();
    p.streams.push(newStream({ name: 'Blank' }));
    const back = parseFile(serialise(toFile(p, 'test')));
    expect(back.streams).toHaveLength(5);
    expect(Number.isNaN(back.streams[4].tSupply)).toBe(true);
    expect(analyse(back).pt.qhMin).toBeCloseTo(107.5, 9);
  });

  it('rejects files from a newer schema', () => {
    const text = JSON.stringify({ kind: 'hinext-project', schemaVersion: 99, project: { ...emptyProject(), schemaVersion: 99 } });
    expect(() => parseFile(text)).toThrow(/newer version/);
  });
});

describe('utility duty limits', () => {
  const base = (): Project => ({
    ...EXAMPLES[0].build(),
    utilities: [
      { id: 'hp', name: 'HP', kind: 'hot', tSupply: 180, tTarget: 180, cost: 150 },
      { id: 'lp', name: 'LP', kind: 'hot', tSupply: 100, tTarget: 100, cost: 80 },
      { id: 'bfw', name: 'Warm sink', kind: 'cold', tSupply: 65, tTarget: 65, cost: -5 },
      { id: 'cw', name: 'CW', kind: 'cold', tSupply: 10, tTarget: 20, cost: 10 },
    ],
  });
  const duties = (p: Project) => Object.fromEntries(analyse(p, 10).utilityTargets.map((u) => [u.id, u.duty]));

  it('a capped hot utility passes the rest to the next hotter one', () => {
    const p = base();
    p.utilities[1].maxDuty = 10; // LP could take 15
    const d = duties(p);
    close(d.lp, 10);
    close(d.hp, 10);
    expect(analyse(p, 10).utilityTargets.find((u) => u.id === 'lp')!.limited).toBe(true);
  });

  it('a capped cold utility passes the rest to the next colder one', () => {
    const p = base();
    p.utilities[2].maxDuty = 20; // warm sink could take 37.5
    const d = duties(p);
    close(d.bfw, 20, 1e-5);
    close(d.cw, 40, 1e-5);
  });

  it('a limit above what the process allows changes nothing', () => {
    const p = base();
    p.utilities[1].maxDuty = 100;
    close(duties(p).lp, 15);
    expect(analyse(p, 10).utilityTargets.find((u) => u.id === 'lp')!.limited).toBe(false);
  });

  it('capping the only utility leaves unmet demand', () => {
    const p = EXAMPLES[0].build();
    p.utilities[0].maxDuty = 5;
    const a = analyse(p, 10);
    close(a.unmetHot, 15);
  });
});
