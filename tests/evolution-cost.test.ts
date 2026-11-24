import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analyse';
import { analyseNetwork } from '../src/core/network';
import { applyShift, breakLoop, endsFor, findLoops, loopCount } from '../src/core/evolution';
import { EXAMPLES } from '../src/examples';
import type { Project } from '../src/core/types';

const ex = (key: string) => EXAMPLES.find((e) => e.key === key)!.build();

// Hand calculation, independent of the app's code: A = Q / (U · LMTD), capital 10 000 + 800·A^0.8 per unit,
// annualised at 10 % over 5 years, operating = steam 120 + cooling water 10 $/kW·yr.
const lmtd = (d1: number, d2: number) => (Math.abs(d1 - d2) < 1e-12 ? d1 : (d1 - d2) / Math.log(d1 / d2));
const U = 1 / (1 / 0.2 + 1 / 0.2);
const area = (q: number, hin: number, hout: number, cin: number, cout: number) => q / (U * lmtd(hin - cout, hout - cin));
const capital = (a: number) => 10000 + 800 * Math.pow(a, 0.8);
const af = (0.1 * Math.pow(1.1, 5)) / (Math.pow(1.1, 5) - 1);
const total = (areas: number[], qh: number, qc: number) => areas.reduce((t, a) => t + capital(a), 0) * af + qh * 120 + qc * 10;

describe('evolution: total cost at each step against hand calculations (Kemp)', () => {
  it('MER network', () => {
    const p = ex('kemp-4-mer');
    const net = analyseNetwork(p, analyse(p));
    const hand = [
      area(240, 170, 90, 80, 140), // E1 Hot 2–Cold 3
      area(90, 150, 90, 80, 125), // E2 Hot 4–Cold 1, above
      area(20, 180, 180, 125, 135), // H1 steam on Cold 1
      area(90, 90, 60, 35, 80), // E3 Hot 2–Cold 1, below
      area(30, 90, 70, 20, 35), // E4 Hot 4–Cold 1, below
      area(60, 70, 30, 10, 20), // C1 cooling water on Hot 4
    ];
    net.units.forEach((r, i) => expect(r.area).toBeCloseTo(hand[i], 6));
    expect(net.total).toBeCloseTo(total(hand, 20, 60), 4);
  });

  it('after breaking the Hot 4–Cold 1 loop (x = 30 kW removes E4)', () => {
    const p = ex('kemp-4-mer');
    const units = p.network!.units;
    const loop = findLoops(units)[0];
    const b = breakLoop(units, loop);
    expect(b.x).toBe(30);
    const q: Project = { ...p, network: { units: applyShift(units, b.signs, b.x) } };
    const net = analyseNetwork(q, analyse(q));
    // Cold 1 in flow order: E3 20→65, E2 (now 120 kW) 65→125, H1 125→135; Hot 4: E2 150→70, C1 70→30
    const hand = [area(240, 170, 90, 80, 140), area(120, 150, 70, 65, 125), area(20, 180, 180, 125, 135), area(90, 90, 60, 20, 65), area(60, 70, 30, 10, 20)];
    net.units.forEach((r, i) => expect(r.area).toBeCloseTo(hand[i], 6));
    expect(net.unitCount).toBe(5);
    expect(net.total).toBeCloseTo(total(hand, 20, 60), 4);
  });
});

describe('evolution on split networks', () => {
  it('treats each branch as its own node', () => {
    const p = ex('smith-split-mer');
    const units = p.network!.units;
    const ends = endsFor(p, true);
    expect(ends(units.find((u) => u.id === 'E1')!)).toEqual(['s1#1', 's3']);
    expect(ends(units.find((u) => u.id === 'E2')!)).toEqual(['s1#2', 's4']);
    expect(ends(units.find((u) => u.id === 'E3')!)).toEqual(['s1', 's3']);
    // 7 units, nodes s1#1 s1#2 s1 s2 s3 s4 furnace water = 8, one component → no loops
    expect(loopCount(units, ends).loops).toBe(0);
    expect(findLoops(units, ends)).toHaveLength(0);
  });
});
