import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analyse';
import { analyseNetwork, endRemaining, tickOffLoad } from '../src/core/network';
import { designGuide } from '../src/core/guide';
import { apply } from '../src/state/actions';
import { EXAMPLES } from '../src/examples';
import type { NetUnit, Project } from '../src/core/types';

const kemp = () => EXAMPLES[0].build();
const lh = () => EXAMPLES[1].build();
const run = (p: Project) => {
  const a = analyse(p);
  return { a, net: analyseNetwork(p, a, 'pinch') };
};
const withNet = (p: Project, units: NetUnit[], splits: NonNullable<Project['network']>['splits'] = []): Project => ({ ...p, network: { units, splits } });

describe('stream splits: thermal model', () => {
  // Kemp: Cold 3 (CP 4, 80 → 140, 240 kW above the pinch) split 3 : 1 above the pinch
  const split = [{ id: 'sp', stream: 's3', side: 'above' as const, fractions: [0.75, 0.25] }];

  it('a branch heats with its own CP and the branches share the duty', () => {
    const p = withNet(kemp(), [{ id: 'e1', kind: 'exchanger', hot: 's2', cold: 's3', load: 180, x: 0.45, coldBranch: 0 }], split);
    const { net } = run(p);
    const e1 = net.units.find((u) => u.id === 'e1')!;
    expect(e1.coldIn).toBeCloseTo(80, 6);
    expect(e1.coldOut).toBeCloseTo(140, 6); // 180 kW on CP 3
    const br = net.streams.get('s3')!.branches!.above!;
    expect(br.map((b) => b.cp)).toEqual([3, 1]);
    expect(br.map((b) => b.remaining)).toEqual([0, 60]);
    expect(endRemaining(net, 's3', 0.4, 1)).toBeCloseTo(60, 6);
    expect(tickOffLoad(net, 's4', 's3', 0.4, undefined, 1)).toBeCloseTo(60, 6);
    // a split stream counts once per branch at the pinch
    expect(net.pinchCounts!.aboveCold).toBe(3);
  });

  it('branches mix back to the stream target and the CP rule uses branch CPs', () => {
    const p = withNet(
      kemp(),
      [
        { id: 'e1', kind: 'exchanger', hot: 's2', cold: 's3', load: 180, x: 0.45, coldBranch: 0 },
        { id: 'e2', kind: 'exchanger', hot: 's4', cold: 's3', load: 60, x: 0.45, coldBranch: 1 },
      ],
      split,
    );
    const { net } = run(p);
    const e2 = net.units.find((u) => u.id === 'e2')!;
    expect(e2.coldOut).toBeCloseTo(140, 6); // 60 kW on CP 1
    expect(net.streams.get('s3')!.remainingAbove).toBeCloseTo(0, 9);
  });

  it('the guide matches branch by branch and applies the CP rule to branch CPs', () => {
    const p = withNet(kemp(), [], split);
    const { a, net } = run(p);
    const above = designGuide(p, a, net).regions.find((r) => r.region === 'above')!;
    const find = (hot: string, b: number) => above.suggestions.find((s) => s.hot === hot && s.cold === 's3' && s.coldBranch === b)!;
    expect(find('s2', 0).feasible).toBe(true); // CP 3 ≤ 3
    expect(find('s2', 0).load).toBeCloseTo(180, 6);
    expect(find('s4', 1).feasible).toBe(false); // CP 1.5 > 1
    expect(find('s4', 1).problem).toMatch(/CP rule/);
  });

  it('flags a branch that takes more than its share', () => {
    const p = withNet(kemp(), [{ id: 'e1', kind: 'exchanger', hot: 's2', cold: 's3', load: 100, x: 0.45, coldBranch: 1 }], split);
    const { net } = run(p);
    expect(net.issues.some((i) => i.level === 'error' && /branch 2 above the pinch/.test(i.message))).toBe(true);
  });
});

describe('stream splits: design guide (Linnhoff & Hindmarsh 1983)', () => {
  it('suggests splitting H2 below the pinch to match C3 and C4', () => {
    const g = designGuide(lh(), ...((p) => { const r = run(p); return [r.a, r.net] as const; })(lh()));
    const below = g.regions.find((r) => r.region === 'below')!;
    expect(below.split?.stream).toBe('s2');
    expect(below.split?.cps.map((c) => +c.toFixed(6))).toEqual([3, 5]);
  });

  it('following the split and match suggestions reaches the energy targets', () => {
    let p = lh();
    for (let step = 0; step < 12; step++) {
      const { a, net } = run(p);
      const g = designGuide(p, a, net);
      const sp = g.regions.map((r) => r.split).find(Boolean);
      if (sp) {
        p = apply(p, { type: 'split/set', stream: sp.stream, side: sp.region, fractions: sp.fractions });
        continue;
      }
      const next = g.regions.flatMap((r) => r.suggestions).find((s) => s.feasible);
      if (!next) break;
      p = apply(p, { type: 'unit/add', unit: { id: `G${step}`, kind: 'exchanger', hot: next.hot, cold: next.cold, load: next.load, x: next.x, hotBranch: next.hotBranch, coldBranch: next.coldBranch } });
    }
    const { a, net } = run(p);
    expect(net.issues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(net.issues.filter((i) => /ΔTmin|CP hot|across the pinch/.test(i.message))).toHaveLength(0);
    const remAbove = [...net.streams.values()].reduce((t, s) => t + Math.max(0, s.remainingAbove), 0);
    const remBelow = [...net.streams.values()].reduce((t, s) => t + Math.max(0, s.remainingBelow), 0);
    expect(remAbove).toBeCloseTo(a.pt.qhMin, 6);
    expect(remBelow).toBeCloseTo(a.pt.qcMin, 6);
    expect(p.network!.splits).toHaveLength(1);
  });
});

describe('stream splits: actions', () => {
  it('keeps splits when units change and clears branches when a split is removed', () => {
    let p = withNet(kemp(), [{ id: 'e1', kind: 'exchanger', hot: 's2', cold: 's3', load: 60, x: 0.45, coldBranch: 2 }], []);
    p = apply(p, { type: 'split/set', stream: 's3', side: 'above', fractions: [0.5, 0.25, 0.25] });
    p = apply(p, { type: 'unit/update', id: 'e1', patch: { load: 50 } });
    expect(p.network!.splits).toHaveLength(1);
    p = apply(p, { type: 'split/set', stream: 's3', side: 'above', fractions: [0.5, 0.5] });
    expect(p.network!.units[0].coldBranch).toBe(1);
    p = apply(p, { type: 'split/set', stream: 's3', side: 'above', fractions: null });
    expect(p.network!.splits).toHaveLength(0);
    expect(p.network!.units[0].coldBranch).toBeUndefined();
  });
});

describe('design guide: placement', () => {
  it('places each suggested match clear of the units already on the grid', () => {
    for (const build of [kemp, lh]) {
      let p = build();
      for (let step = 0; step < 12; step++) {
        const { a, net } = run(p);
        const g = designGuide(p, a, net);
        const sp = g.regions.map((r) => r.split).find(Boolean);
        if (sp) {
          p = apply(p, { type: 'split/set', stream: sp.stream, side: sp.region, fractions: sp.fractions });
          continue;
        }
        const next = g.regions.flatMap((r) => r.suggestions).find((s) => s.feasible);
        if (!next) break;
        // working away from the pinch: left of everything above it, right of everything below it
        const before = p.network?.units ?? [];
        const aboveXs = before.filter((u) => u.x < 0.5).map((u) => u.x);
        const belowXs = before.filter((u) => u.x >= 0.5).map((u) => u.x);
        if (next.x < 0.5 && aboveXs.length) expect(next.x).toBeLessThan(Math.min(...aboveXs));
        if (next.x >= 0.5 && belowXs.length) expect(next.x).toBeGreaterThan(Math.max(...belowXs));
        p = apply(p, { type: 'unit/add', unit: { id: `G${step}`, kind: 'exchanger', hot: next.hot, cold: next.cold, load: next.load, x: next.x, hotBranch: next.hotBranch, coldBranch: next.coldBranch } });
      }
      const xs = p.network!.units.map((u) => u.x).sort((x, y) => x - y);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(0.03 - 1e-9);
    }
  });
});
