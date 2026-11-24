import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analyse';
import { analyseNetwork } from '../src/core/network';
import { designGuide } from '../src/core/guide';
import { EXAMPLES } from '../src/examples';
import type { NetUnit, Project } from '../src/core/types';

const guideFor = (p: Project) => {
  const a = analyse(p);
  return designGuide(p, a, analyseNetwork(p, a, 'pinch'));
};

describe('design guide (Kemp four-stream problem)', () => {
  it('above the pinch, suggests only pinch matches and flags the CP rule', () => {
    const g = guideFor(EXAMPLES[0].build());
    const above = g.regions.find((r) => r.region === 'above')!;
    expect(above.pinchHot.sort()).toEqual(['s2', 's4']);
    expect(above.pinchCold.sort()).toEqual(['s1', 's3']);
    expect(above.numberRuleOk).toBe(true);
    expect(above.suggestions.every((s) => s.pinchMatch)).toBe(true);
    const ok = above.suggestions.filter((s) => s.feasible).map((s) => `${s.hot}-${s.cold}`);
    // Hot 2 (CP 3) can only go with Cold 3 (CP 4); Hot 4 (1.5) with Cold 1 (2) or Cold 3 (4)
    expect(ok).toContain('s2-s3');
    expect(ok).toContain('s4-s1');
    expect(ok).not.toContain('s2-s1');
    const bad = above.suggestions.find((s) => s.hot === 's2' && s.cold === 's1')!;
    expect(bad.problem).toMatch(/CP rule/);
    // best first: the largest feasible load
    expect(above.suggestions[0].hot + above.suggestions[0].cold).toBe('s2s3');
    expect(above.suggestions[0].load).toBe(240);
  });

  it('below the pinch, Hot 2–Cold 1 is the feasible pinch match', () => {
    const g = guideFor(EXAMPLES[0].build());
    const below = g.regions.find((r) => r.region === 'below')!;
    expect(below.pinchCold).toEqual(['s1']);
    const first = below.suggestions.find((s) => s.feasible)!;
    expect(first.pinchMatch).toBe(true);
    expect(first.load).toBe(90);
  });

  it('following the suggestions reproduces the MER design', () => {
    let p: Project = EXAMPLES[0].build();
    let n = 0;
    for (let step = 0; step < 10; step++) {
      const g = guideFor(p);
      const next = g.regions.flatMap((r) => r.suggestions).find((s) => s.feasible);
      if (!next) break;
      const u: NetUnit = { id: `G${++n}`, kind: 'exchanger', hot: next.hot, cold: next.cold, load: next.load, x: next.x };
      p = { ...p, network: { units: [...(p.network?.units ?? []), u] } };
    }
    const a = analyse(p);
    const net = analyseNetwork(p, a, 'pinch');
    expect(net.issues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(net.issues.filter((i) => i.message.includes('ΔTmin'))).toHaveLength(0);
    // what is left is exactly the utility targets: 20 kW heating above, 60 kW cooling below
    const remAbove = [...net.streams.values()].reduce((t, s) => t + Math.max(0, s.remainingAbove), 0);
    const remBelow = [...net.streams.values()].reduce((t, s) => t + Math.max(0, s.remainingBelow), 0);
    expect(remAbove).toBeCloseTo(20, 6);
    expect(remBelow).toBeCloseTo(60, 6);
  });
});
