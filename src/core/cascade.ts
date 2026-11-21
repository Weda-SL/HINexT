import { EPS, type ResolvedStream } from './streams';

/** One temperature interval of the Problem Table (shifted temperatures). */
export interface PTInterval {
  tTop: number;
  tBot: number;
  dT: number;
  /** IDs of streams present in the interval */
  hotIds: string[];
  coldIds: string[];
  sumCpHot: number;
  sumCpCold: number;
  /** ΣCPhot − ΣCPcold, kW/K */
  netCp: number;
  /** Interval heat balance, kW. Positive = surplus, negative = deficit. */
  dH: number;
}

export interface ProblemTable {
  /** Shifted temperature boundaries, descending */
  boundaries: number[];
  intervals: PTInterval[];
  /** Heat flow at each boundary with zero hot utility (may go negative) */
  infeasible: number[];
  /** Heat flow at each boundary with QHmin added at the top (never negative) */
  feasible: number[];
  qhMin: number;
  qcMin: number;
  /** Shifted pinch temperatures (interior boundaries where feasible flow = 0) */
  pinches: number[];
  /** True when one utility target is zero (threshold problem) */
  threshold: boolean;
}

function uniqueDesc(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => b - a);
  const out: number[] = [];
  for (const v of sorted) if (out.length === 0 || out[out.length - 1] - v > EPS) out.push(v);
  return out;
}

/** The Problem Table Algorithm (Linnhoff & Flower, 1978). */
export function problemTable(streams: ResolvedStream[]): ProblemTable {
  if (streams.length === 0) {
    return { boundaries: [], intervals: [], infeasible: [], feasible: [], qhMin: 0, qcMin: 0, pinches: [], threshold: true };
  }
  const boundaries = uniqueDesc(streams.flatMap((s) => [s.sTs, s.sTt]));
  const intervals: PTInterval[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const tTop = boundaries[i];
    const tBot = boundaries[i + 1];
    const hotIds: string[] = [];
    const coldIds: string[] = [];
    let sumCpHot = 0;
    let sumCpCold = 0;
    for (const s of streams) {
      const hi = Math.max(s.sTs, s.sTt);
      const lo = Math.min(s.sTs, s.sTt);
      if (hi >= tTop - EPS && lo <= tBot + EPS) {
        if (s.kind === 'hot') {
          hotIds.push(s.id);
          sumCpHot += s.cp;
        } else {
          coldIds.push(s.id);
          sumCpCold += s.cp;
        }
      }
    }
    const dT = tTop - tBot;
    const netCp = sumCpHot - sumCpCold;
    intervals.push({ tTop, tBot, dT, hotIds, coldIds, sumCpHot, sumCpCold, netCp, dH: netCp * dT });
  }

  const infeasible = [0];
  for (const iv of intervals) infeasible.push(infeasible[infeasible.length - 1] + iv.dH);
  const qhMin = Math.max(0, -Math.min(...infeasible));
  const feasible = infeasible.map((q) => clean(q + qhMin));
  const qcMin = feasible[feasible.length - 1];

  const pinches: number[] = [];
  for (let i = 1; i < feasible.length - 1; i++) if (Math.abs(feasible[i]) < tol(qhMin, qcMin)) pinches.push(boundaries[i]);
  // A zero at the very top or bottom is a pinch only if that utility is non-zero there,
  // which cannot happen — so those are threshold cases.
  const threshold = qhMin < tol(qhMin, qcMin) || qcMin < tol(qhMin, qcMin);
  return { boundaries, intervals, infeasible, feasible, qhMin: clean(qhMin), qcMin: clean(qcMin), pinches, threshold };
}

function tol(...scale: number[]): number {
  return 1e-9 * Math.max(1, ...scale.map(Math.abs));
}

/** Remove floating-point dust (e.g. 1e-14) so tables show clean zeros. */
export function clean(x: number): number {
  return Math.abs(x) < 1e-9 ? 0 : x;
}

// ---------------------------------------------------------------------------
// Generic cascade, used to place utilities. Items can be temperature ranges with
// a CP, or point heat sources/sinks at one temperature (isothermal utilities).
// Positive = heat released (hot side), negative = heat absorbed (cold side).
// ---------------------------------------------------------------------------

export type HeatItem =
  | { kind: 'range'; top: number; bot: number; cp: number }
  | { kind: 'point'; t: number; q: number };

/**
 * Heat flow just BELOW each boundary, cascading downward from zero at the top.
 * Returns the minimum flow (including the zero entering at the top).
 */
export function cascadeMin(items: HeatItem[]): number {
  const temps = uniqueDesc(items.flatMap((it) => (it.kind === 'range' ? [it.top, it.bot] : [it.t])));
  let flow = 0;
  let min = 0;
  for (let i = 0; i < temps.length; i++) {
    const t = temps[i];
    if (i > 0) {
      const tTop = temps[i - 1];
      let netCp = 0;
      for (const it of items) if (it.kind === 'range' && it.top >= tTop - EPS && it.bot <= t + EPS) netCp += it.cp;
      flow += netCp * (tTop - t);
      // a sink at t must be fed from above t, so check the flow arriving at t first
      min = Math.min(min, flow);
    }
    for (const it of items) if (it.kind === 'point' && Math.abs(it.t - t) < EPS) flow += it.q;
    min = Math.min(min, flow);
  }
  return min;
}

export function streamItems(streams: ResolvedStream[]): HeatItem[] {
  return streams.map((s) => ({
    kind: 'range' as const,
    top: Math.max(s.sTs, s.sTt),
    bot: Math.min(s.sTs, s.sTt),
    cp: s.kind === 'hot' ? s.cp : -s.cp,
  }));
}
