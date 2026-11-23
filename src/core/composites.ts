import { EPS, type Piece, type ResolvedStream, type ResolvedUtility } from './streams';
import type { ProblemTable } from './cascade';
import type { UtilityTarget } from './utilities';

export interface Point {
  /** Enthalpy, kW */
  h: number;
  /** Temperature, °C (actual or shifted) */
  t: number;
}

/**
 * Composite curve of one set of streams, as (H, T) points in ascending T,
 * starting at H = offset.
 */
export function compositeCurve(
  streams: ResolvedStream[],
  shifted: boolean,
  offset = 0,
): Point[] {
  const pieces = streams.flatMap((s) => s.pieces);
  if (pieces.length === 0) return [];
  const lo = (p: Piece) => (shifted ? p.sLo : p.lo);
  const hi = (p: Piece) => (shifted ? p.sHi : p.hi);
  const temps = uniqueAsc(pieces.flatMap((p) => [lo(p), hi(p)]));
  const pts: Point[] = [{ h: offset, t: temps[0] }];
  let h = offset;
  for (let i = 0; i < temps.length; i++) {
    const t = temps[i];
    if (i > 0) {
      const a = temps[i - 1];
      let cp = 0;
      for (const p of pieces) if (!p.iso && lo(p) <= a + EPS && hi(p) >= t - EPS) cp += p.cp;
      h += cp * (t - a);
      pts.push({ h, t });
    }
    // phase change: horizontal step at constant temperature
    let q = 0;
    for (const p of pieces) if (p.iso && Math.abs(lo(p) - t) < EPS) q += p.q;
    if (q > 0) {
      h += q;
      pts.push({ h, t });
    }
  }
  return pts;
}

export interface CompositeSet {
  hot: Point[];
  cold: Point[];
}

/** Hot composite from H = 0; cold composite shifted right by QCmin so the curves touch at the pinch. */
export function composites(streams: ResolvedStream[], pt: ProblemTable, shifted: boolean): CompositeSet {
  return {
    hot: compositeCurve(streams.filter((s) => s.kind === 'hot'), shifted, 0),
    cold: compositeCurve(streams.filter((s) => s.kind === 'cold'), shifted, pt.qcMin),
  };
}

/** Grand composite curve: net heat flow (feasible cascade) vs shifted temperature. */
export function grandComposite(pt: ProblemTable): Point[] {
  const pts: Point[] = [];
  pt.boundaries.forEach((t, i) => {
    // with phase change at t, the curve steps horizontally from the flow arriving at t to the flow leaving it
    const arriving = i === 0 ? pt.qhMin : pt.feasible[i - 1] + pt.intervals[i - 1].dH;
    if (Math.abs(arriving - pt.feasible[i]) > 1e-9) pts.push({ h: arriving, t });
    pts.push({ h: pt.feasible[i], t });
  });
  return pts;
}

export interface UtilityProfile {
  id: string;
  name: string;
  kind: 'hot' | 'cold';
  points: Point[];
}

/**
 * Utility lines to draw on the GCC (shifted temperatures). Hot utilities stack
 * from the coldest level at H = 0; cold utilities stack from the warmest level.
 */
export function utilityProfiles(utilities: ResolvedUtility[], targets: UtilityTarget[]): UtilityProfile[] {
  const duty = new Map(targets.map((t) => [t.id, t.duty]));
  const out: UtilityProfile[] = [];
  const build = (list: ResolvedUtility[]) => {
    let h = 0;
    for (const u of list) {
      const q = duty.get(u.id) ?? 0;
      if (q <= 0) continue;
      // the end nearer the pinch sits at the smaller H
      const near = u.kind === 'hot' ? u.sTt : u.sTt;
      const far = u.kind === 'hot' ? u.sTs : u.sTs;
      out.push({ id: u.id, name: u.name, kind: u.kind, points: [{ h, t: near }, { h: h + q, t: far }] });
      h += q;
    }
  };
  build(utilities.filter((u) => u.kind === 'hot').sort((a, b) => a.sTs - b.sTs || a.sTt - b.sTt));
  build(utilities.filter((u) => u.kind === 'cold').sort((a, b) => b.sTt - a.sTt || b.sTs - a.sTs));
  return out;
}

function uniqueAsc(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || v - out[out.length - 1] > EPS) out.push(v);
  return out;
}

export { uniqueAsc };
