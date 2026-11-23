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

/** Phase-change (latent) heat at one shifted temperature. */
export interface LatentPoint {
  t: number;
  /** Heat released by hot streams at t, kW */
  hot: number;
  /** Heat absorbed by cold streams at t, kW */
  cold: number;
  hotIds: string[];
  coldIds: string[];
}

export interface ProblemTable {
  /** Shifted temperature boundaries, descending */
  boundaries: number[];
  intervals: PTInterval[];
  /** Phase-change heat at boundaries (empty when no stream changes phase) */
  latent: LatentPoint[];
  /** Heat flow just below each boundary with zero hot utility (may go negative) */
  infeasible: number[];
  /** Heat flow just below each boundary with QHmin added at the top (never negative) */
  feasible: number[];
  qhMin: number;
  qcMin: number;
  /** Shifted pinch temperatures (interior boundaries where the feasible flow = 0) */
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

/**
 * The Problem Table Algorithm (Linnhoff & Flower, 1978), extended to
 * piecewise-linear streams and phase change (heat at a single temperature).
 */
export function problemTable(streams: ResolvedStream[]): ProblemTable {
  if (streams.length === 0) {
    return { boundaries: [], intervals: [], latent: [], infeasible: [], feasible: [], qhMin: 0, qcMin: 0, pinches: [], threshold: true };
  }
  const boundaries = uniqueDesc(streams.flatMap((s) => s.pieces.flatMap((p) => [p.sLo, p.sHi])));
  const intervals: PTInterval[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const tTop = boundaries[i];
    const tBot = boundaries[i + 1];
    const hotIds: string[] = [];
    const coldIds: string[] = [];
    let sumCpHot = 0;
    let sumCpCold = 0;
    for (const s of streams) {
      let cp = 0;
      for (const p of s.pieces) if (!p.iso && p.sHi >= tTop - EPS && p.sLo <= tBot + EPS) cp += p.cp;
      if (cp <= 0) continue;
      if (s.kind === 'hot') {
        hotIds.push(s.id);
        sumCpHot += cp;
      } else {
        coldIds.push(s.id);
        sumCpCold += cp;
      }
    }
    const dT = tTop - tBot;
    const netCp = sumCpHot - sumCpCold;
    intervals.push({ tTop, tBot, dT, hotIds, coldIds, sumCpHot, sumCpCold, netCp, dH: netCp * dT });
  }

  const latentAt = boundaries.map((t) => {
    const lp: LatentPoint = { t, hot: 0, cold: 0, hotIds: [], coldIds: [] };
    for (const s of streams)
      for (const p of s.pieces)
        if (p.iso && Math.abs(p.sLo - t) < EPS) {
          if (s.kind === 'hot') {
            lp.hot += p.q;
            lp.hotIds.push(s.id);
          } else {
            lp.cold += p.q;
            lp.coldIds.push(s.id);
          }
        }
    return lp;
  });

  // Flow arriving at each boundary from above, and leaving below it after any latent heat.
  const above: number[] = [];
  const below: number[] = [];
  let flow = 0;
  for (let i = 0; i < boundaries.length; i++) {
    if (i > 0) flow += intervals[i - 1].dH;
    above.push(flow);
    flow += latentAt[i].hot - latentAt[i].cold;
    below.push(flow);
  }
  const qhMin = Math.max(0, -Math.min(0, ...above, ...below));
  const feasible = below.map((q) => clean(q + qhMin));
  const qcMin = feasible[feasible.length - 1];
  const t0 = tol(qhMin, qcMin);

  const pinches: number[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const a = above[i] + qhMin;
    const b = below[i] + qhMin;
    const interior = i > 0 && i < boundaries.length - 1;
    const touchesAbove = i > 0 && Math.abs(a) < t0;
    const touchesBelow = i < boundaries.length - 1 && Math.abs(b) < t0;
    if ((interior && (touchesAbove || touchesBelow)) || (!interior && latentAt[i].hot + latentAt[i].cold > 0 && (touchesAbove || touchesBelow))) {
      pinches.push(boundaries[i]);
    }
  }
  const threshold = qhMin < t0 || qcMin < t0;
  return {
    boundaries,
    intervals,
    latent: latentAt.filter((l) => l.hot > 0 || l.cold > 0),
    infeasible: below.map(clean),
    feasible,
    qhMin: clean(qhMin),
    qcMin: clean(qcMin),
    pinches,
    threshold,
  };
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
  return streams.flatMap((s) =>
    s.pieces.map((p): HeatItem => {
      const sign = s.kind === 'hot' ? 1 : -1;
      return p.iso ? { kind: 'point', t: p.sLo, q: sign * p.q } : { kind: 'range', top: p.sHi, bot: p.sLo, cp: sign * p.cp };
    }),
  );
}
