import { describe, expect, it } from 'vitest';
import { analyse } from '../src/core/analyse';
import { EXAMPLES } from '../src/examples';
import { newStream } from '../src/core/project';
import type { Project, Stream } from '../src/core/types';

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol * Math.max(1, Math.abs(b)));

const kemp = () => EXAMPLES[0].build();

/** Replace a stream in a project. */
function withStream(p: Project, id: string, patch: Partial<Stream>): Project {
  return { ...p, streams: p.streams.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

describe('non-linear streams', () => {
  it('a profile with the same CP everywhere gives the same targets as the linear stream', () => {
    const base = analyse(kemp(), 10);
    const p = withStream(kemp(), 's2', {
      profile: 'nonlinear',
      profileData: { temps: [170, 120, 60], segments: [{ spec: 'cp', cp: 3 }, { spec: 'duty', duty: 180 }], hConstant: true },
    });
    const a = analyse(p, 10);
    close(a.pt.qhMin, base.pt.qhMin);
    close(a.pt.qcMin, base.pt.qcMin);
    close(a.area.total!, base.area.total!);
    expect(a.units.mer).toBe(base.units.mer);
    expect(a.streams.find((s) => s.id === 's2')!.duty).toBeCloseTo(330, 9);
  });

  it('two segments match the same heat split into two separate linear streams', () => {
    // Hot 2: 170→120 at CP 5, then 120→60 at CP 2 — compare with two linear streams.
    const nl = withStream(kemp(), 's2', {
      profile: 'nonlinear',
      profileData: { temps: [170, 120, 60], segments: [{ spec: 'cp', cp: 5 }, { spec: 'cp', cp: 2 }], hConstant: true },
    });
    const split: Project = {
      ...kemp(),
      streams: [
        ...kemp().streams.filter((s) => s.id !== 's2'),
        newStream({ id: 'a', name: 'A', tSupply: 170, tTarget: 120, cp: 5, h: 0.2 }),
        newStream({ id: 'b', name: 'B', tSupply: 120, tTarget: 60, cp: 2, h: 0.2 }),
      ],
    };
    const a = analyse(nl, 10);
    const b = analyse(split, 10);
    close(a.pt.qhMin, b.pt.qhMin);
    close(a.pt.qcMin, b.pt.qcMin);
    close(a.area.total!, b.area.total!);
    // ...but it is still one stream for the units target
    expect(a.units.mer).toBeLessThanOrEqual(b.units.mer);
  });

  it('only the part of the profile between supply and target is used', () => {
    const p = withStream(kemp(), 's2', {
      profile: 'nonlinear',
      profileData: { temps: [250, 200, 20], segments: [{ spec: 'cp', cp: 9 }, { spec: 'cp', cp: 3 }], hConstant: true },
    });
    const a = analyse(p, 10);
    close(a.pt.qhMin, 20);
    close(a.pt.qcMin, 60);
    expect(a.streams.find((s) => s.id === 's2')!.duty).toBeCloseTo(330, 9);
  });

  it('reports a profile that does not cover the supply–target range', () => {
    const p = withStream(kemp(), 's2', {
      profile: 'nonlinear',
      profileData: { temps: [170, 100], segments: [{ spec: 'cp', cp: 3 }], hConstant: true },
    });
    const a = analyse(p, 10);
    expect(a.streams.find((s) => s.id === 's2')).toBeUndefined();
    expect(a.issues.some((i) => i.message.includes('does not cover'))).toBe(true);
  });

  it('rejects profiles that change direction', () => {
    const p = withStream(kemp(), 's2', {
      profile: 'nonlinear',
      profileData: { temps: [170, 100, 120, 60], segments: [{ spec: 'cp', cp: 3 }, { spec: 'cp', cp: 3 }, { spec: 'cp', cp: 3 }], hConstant: true },
    });
    expect(analyse(p, 10).issues.some((i) => i.message.includes('keep rising or keep falling'))).toBe(true);
  });

  it('uses per-segment film coefficients for the area', () => {
    // Same as splitting into two streams with different h.
    const nl = withStream(kemp(), 's2', {
      profile: 'nonlinear',
      profileData: { temps: [170, 120, 60], segments: [{ spec: 'cp', cp: 3, h: 1 }, { spec: 'cp', cp: 3, h: 0.1 }], hConstant: false },
    });
    const split: Project = {
      ...kemp(),
      streams: [
        ...kemp().streams.filter((s) => s.id !== 's2'),
        newStream({ id: 'a', name: 'A', tSupply: 170, tTarget: 120, cp: 3, h: 1 }),
        newStream({ id: 'b', name: 'B', tSupply: 120, tTarget: 60, cp: 3, h: 0.1 }),
      ],
    };
    close(analyse(nl, 10).area.total!, analyse(split, 10).area.total!);
  });
});

describe('phase change (heat at one temperature)', () => {
  // Hot 2 condenses 60 kW at 120 °C in the middle of its 170→60 range.
  const condensing = () =>
    withStream(kemp(), 's2', {
      profile: 'nonlinear',
      profileData: {
        temps: [170, 120, 120, 60],
        segments: [{ spec: 'cp', cp: 3 }, { spec: 'duty', duty: 60 }, { spec: 'cp', cp: 3 }],
        hConstant: true,
      },
    });

  it('gives finite targets with no division by zero', () => {
    const a = analyse(condensing(), 10);
    expect(a.issues.filter((i) => i.level === 'error')).toHaveLength(0);
    for (const v of [a.pt.qhMin, a.pt.qcMin, a.area.total!, a.cost.total]) expect(Number.isFinite(v)).toBe(true);
    expect(a.streams[1].duty).toBeCloseTo(390, 9);
    expect(a.pt.latent).toHaveLength(1);
    close(a.pt.latent[0].t, 115);
  });

  it('matches a very steep linear segment (1 mK) in the limit', () => {
    const steep = withStream(kemp(), 's2', {
      profile: 'nonlinear',
      profileData: {
        temps: [170, 120.0005, 119.9995, 60],
        segments: [{ spec: 'cp', cp: 3 }, { spec: 'duty', duty: 60 }, { spec: 'cp', cp: 3 }],
        hConstant: true,
      },
    });
    const a = analyse(condensing(), 10);
    const b = analyse(steep, 10);
    close(a.pt.qhMin, b.pt.qhMin, 1e-3);
    close(a.pt.qcMin, b.pt.qcMin, 1e-3);
    close(a.area.total!, b.area.total!, 1e-3);
  });

  it('hand-calculated cascade: QH,min = 0, QC,min = 100 kW', () => {
    // Extra 60 kW released at shifted 115 °C, inside the deficit region 140→85.
    // Cascade: 0, 60, 62.5, then 25 arriving at 115 → 85 after the latent heat, 40 at 85, 115 at 55, 100 at 25.
    // No negative flow, so QH,min = 0; energy balance gives QC,min = 60 + 60 − 20 = 100 kW.
    const a = analyse(condensing(), 10);
    close(a.pt.qhMin, 0);
    close(a.pt.qcMin, 100);
    a.pt.infeasible.forEach((q, i) => close(q, [0, 60, 62.5, 85, 40, 115, 100][i]));
    // the GCC steps horizontally at 115 °C, from 25 kW arriving to 85 kW leaving
    const at115 = a.gcc.filter((pt) => Math.abs(pt.t - 115) < 1e-9).map((pt) => pt.h);
    expect(at115).toHaveLength(2);
    close(at115[0], 25);
    close(at115[1], 85);
  });

  it('a phase change needs a heat load', () => {
    const p = withStream(kemp(), 's2', {
      profile: 'nonlinear',
      profileData: { temps: [170, 120, 120, 60], segments: [{ spec: 'cp', cp: 3 }, { spec: 'cp', cp: 3 }, { spec: 'cp', cp: 3 }], hConstant: true },
    });
    expect(analyse(p, 10).issues.some((i) => i.message.includes('phase-change'))).toBe(true);
  });

  it('a cold stream that boils at the pinch is counted above it for units', () => {
    // Kemp Cold 3 (80→140) boiling 20 kW at its supply temperature 80 °C (shifted 85 °C = the pinch).
    const p = withStream(kemp(), 's3', {
      profile: 'nonlinear',
      profileData: { temps: [80, 80, 140], segments: [{ spec: 'duty', duty: 20 }, { spec: 'cp', cp: 4 }], hConstant: true },
    });
    const a = analyse(p, 10);
    expect(Number.isFinite(a.pt.qhMin)).toBe(true);
    close(a.pt.qhMin, 40);
    expect(a.units.mer).toBeGreaterThan(0);
  });
});
