import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analyse';
import { analyseNetwork } from '../src/core/network';
import { applyShift, breakLoop, findLoops, findPaths, loopCount, solveShift } from '../src/core/evolution';
import { kempMER } from './fixtures';

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

describe('Kemp four-stream evolution', () => {
  it("Euler's theorem: 6 units, 6 nodes, 1 component → 1 loop", () => {
    const p = kempMER();
    const lc = loopCount(p.network!.units);
    expect(lc).toEqual({ loops: 1, units: 6, nodes: 6, components: 1 });
    const loops = findLoops(p.network!.units);
    expect(loops).toHaveLength(1);
    expect([...loops[0].edges].sort()).toEqual(['E2', 'E4']);
  });

  it('finds the utility path HU → C1 → H4 → CU', () => {
    const p = kempMER();
    const paths = findPaths(p.network!.units, p);
    expect(paths.map((x) => x.edges.join(','))).toContain('H1,E2,C1');
    expect(paths.map((x) => x.edges.join(','))).toContain('H1,E4,C1');
  });

  it('breaking the loop removes E4 (30 kW) and moves its load to E2', () => {
    const p = kempMER();
    const loop = findLoops(p.network!.units)[0];
    const b = breakLoop(p.network!.units, loop);
    expect(b.removes).toBe('E4');
    close(b.x, 30);
    const units = applyShift(p.network!.units, b.signs, b.x);
    expect(units.find((u) => u.id === 'E4')).toBeUndefined();
    close(units.find((u) => u.id === 'E2')!.load, 120);
    // energy is unchanged, but E2 now violates ΔTmin (5 K at its cold end)
    const a = analyse(p);
    const n = analyseNetwork({ ...p, network: { units } }, a);
    close(n.qh, 20);
    close(n.qc, 60);
    expect(n.unitCount).toBe(5);
    const e2 = n.units.find((r) => r.id === 'E2')!;
    close(e2.hotOut, 70);
    close(e2.coldIn, 65);
    close(e2.dtCold, 5);
  });

  it('relaxing along HU → C1 → H4 → CU restores ΔTmin with x = 7.5 kW', () => {
    const p = kempMER();
    const a = analyse(p);
    const loop = findLoops(p.network!.units)[0];
    const b = breakLoop(p.network!.units, loop);
    const broken = applyShift(p.network!.units, b.signs, b.x);
    const path = findPaths(broken, p).find((x) => x.edges.join(',') === 'H1,E2,C1')!;
    const x = solveShift(p, a, broken, path.signs, 'E2');
    expect(x).not.toBeNull();
    close(x!, 7.5, 1e-6);
    const relaxed = applyShift(broken, path.signs, x!);
    const n = analyseNetwork({ ...p, network: { units: relaxed } }, a);
    close(n.qh, 27.5, 1e-6);
    close(n.qc, 67.5, 1e-6);
    close(Math.min(...n.units.map((r) => Math.min(r.dtHot, r.dtCold))), 10, 1e-6);
    expect(n.issues.filter((i) => i.level === 'error')).toHaveLength(0);
    expect(loopCount(relaxed).loops).toBe(0);
  });
});
