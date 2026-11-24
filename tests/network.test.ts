import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analyse';
import { analyseNetwork, profileOf, tickOffLoad } from '../src/core/network';
import { EXAMPLES } from '../src/examples';
import type { Project } from '../src/core/types';
import { kempMER } from './fixtures';

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

const run = (p: Project) => {
  const a = analyse(p);
  return { a, n: analyseNetwork(p, a) };
};

describe('stream profiles', () => {
  it('linear stream temperature from heat exchanged', () => {
    const { a } = run(kempMER());
    const h2 = profileOf(a.streams.find((s) => s.id === 's2')!);
    close(h2.tempAt(0), 170);
    close(h2.tempAt(240), 90);
    close(h2.heatTo(90), 240);
    const c1 = profileOf(a.streams.find((s) => s.id === 's1')!);
    close(c1.tempAt(60), 50);
    close(c1.heatTo(80), 120);
  });
});

describe('Kemp MER network', () => {
  it('meets the energy targets with no errors or warnings', () => {
    const { a, n } = run(kempMER());
    close(n.qh, a.pt.qhMin);
    close(n.qc, a.pt.qcMin);
    expect(n.issues).toEqual([]);
    expect(n.complete).toBe(true);
    expect(n.unitCount).toBe(6);
  });

  it('calculates the temperatures between units', () => {
    const { n } = run(kempMER());
    const u = Object.fromEntries(n.units.map((r) => [r.id, r]));
    // above the pinch
    close(u.E1.hotIn, 170); close(u.E1.hotOut, 90); close(u.E1.coldIn, 80); close(u.E1.coldOut, 140);
    close(u.E2.hotOut, 90); close(u.E2.coldIn, 80); close(u.E2.coldOut, 125);
    close(u.H1.coldIn, 125); close(u.H1.coldOut, 135);
    // below the pinch: C1 meets E4 first (it flows right to left)
    close(u.E4.coldIn, 20); close(u.E4.coldOut, 35); close(u.E4.hotIn, 90); close(u.E4.hotOut, 70);
    close(u.E3.coldIn, 35); close(u.E3.coldOut, 80); close(u.E3.hotIn, 90); close(u.E3.hotOut, 60);
    close(u.C1.hotIn, 70); close(u.C1.hotOut, 30);
    // ΔT exactly ΔTmin at the pinch
    close(u.E1.dtCold, 10);
    close(u.E3.dtHot, 10);
  });

  it('area of each unit from Q / (U · LMTD)', () => {
    const { n } = run(kempMER());
    const e1 = n.units.find((r) => r.id === 'E1')!;
    const lmtd = (30 - 10) / Math.log(3);
    close(e1.lmtd, lmtd);
    close(e1.area, 240 / (0.1 * lmtd)); // h = 0.2 on both sides → U = 0.1
    expect(n.area).toBeGreaterThan(0);
    expect(Number.isFinite(n.total)).toBe(true);
  });
});

describe('feasibility checks', () => {
  it('flags a ΔTmin violation and a temperature cross', () => {
    const p = kempMER();
    p.network!.units.find((u) => u.id === 'E3')!.load = 100; // C1 out 85 > 80; hot in 90 → ΔT 5
    const { n } = run(p);
    expect(n.issues.some((i) => i.unit === 'E3' && i.level === 'warning' && i.message.includes('below ΔTmin'))).toBe(true);
    p.network!.units.find((u) => u.id === 'E3')!.load = 115; // C1 out 92.5 > 90 → cross
    expect(run(p).n.issues.some((i) => i.unit === 'E3' && i.level === 'error')).toBe(true);
  });

  it('flags cross-pinch transfer, heaters below and coolers above the pinch', () => {
    const p = kempMER();
    p.network!.units.push({ id: 'C2', kind: 'cooler', hot: 's2', utility: 'u2', load: 10, x: 0.2 });
    p.network!.units.push({ id: 'H2', kind: 'heater', cold: 's1', utility: 'u1', load: 10, x: 0.95 });
    const { n } = run(p);
    expect(n.issues.some((i) => i.unit === 'C2' && i.message.includes('cools above'))).toBe(true);
    expect(n.issues.some((i) => i.unit === 'H2' && i.message.includes('heats below'))).toBe(true);
    // over-satisfied streams
    expect(n.issues.some((i) => i.stream === 's2' && i.level === 'error')).toBe(true);
  });

  it('flags the CP rule at the pinch', () => {
    // Above the pinch, H2 (CP 3) leaving at the pinch against C1 (CP 2) breaks CPhot ≤ CPcold.
    // Below-pinch units bring C1 to exactly 80 °C, so the match starts at the pinch.
    const p = kempMER();
    const units = p.network!.units;
    units.find((u) => u.id === 'E1')!.load = 180;
    Object.assign(units.find((u) => u.id === 'E2')!, { id: 'X', hot: 's2', load: 60 });
    const { n } = run(p);
    expect(n.issues.some((i) => i.unit === 'X' && i.message.includes('CP hot'))).toBe(true);
  });

  it('reports remaining duties and the tick-off load', () => {
    const p = EXAMPLES[0].build();
    p.network = { units: [{ id: 'E1', kind: 'exchanger', hot: 's2', cold: 's3', load: 240, x: 0.3 }] };
    const { n } = run(p);
    close(n.streams.get('s2')!.remainingAbove, 0);
    close(n.streams.get('s2')!.remainingBelow, 90);
    close(n.streams.get('s1')!.remainingAbove, 110);
    close(tickOffLoad(n, 's4', 's1', 0.35), 90);
    close(tickOffLoad(n, 's2', 's1', 0.6), 90);
    expect(n.complete).toBe(false);
  });
});

describe('pinch design temperatures', () => {
  it('above-pinch units start from the pinch, even with nothing below yet', () => {
    const p = EXAMPLES[0].build();
    p.network = { units: [{ id: 'E2', kind: 'exchanger', hot: 's4', cold: 's1', load: 90, x: 0.35 }] };
    const a = analyse(p);
    const series = analyseNetwork(p, a).units[0];
    close(series.coldIn, 20); // series: Cold 1 still at its supply temperature
    const pinch = analyseNetwork(p, a, 'pinch').units[0];
    close(pinch.coldIn, 80);
    close(pinch.coldOut, 125);
    close(pinch.hotOut, 90);
  });

  it('below-pinch units on a hot stream start from the pinch', () => {
    const p = EXAMPLES[0].build();
    p.network = { units: [{ id: 'E3', kind: 'exchanger', hot: 's2', cold: 's1', load: 90, x: 0.6 }] };
    const a = analyse(p);
    const r = analyseNetwork(p, a, 'pinch').units[0];
    close(r.hotIn, 90);
    close(r.hotOut, 60);
    close(r.coldIn, 20);
    close(r.coldOut, 65);
  });

  it('gives the same result as series for the complete MER design', () => {
    const p = kempMER();
    const a = analyse(p);
    const s = analyseNetwork(p, a).units;
    const q = analyseNetwork(p, a, 'pinch').units;
    s.forEach((r, i) => {
      close(r.hotIn, q[i].hotIn);
      close(r.coldIn, q[i].coldIn);
      close(r.hotOut, q[i].hotOut);
      close(r.coldOut, q[i].coldOut);
    });
  });
});
