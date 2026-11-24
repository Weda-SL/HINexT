import type { Stream, Utility } from './types';

export const EPS = 1e-7;

/**
 * A linear piece of a stream's temperature–enthalpy profile (actual temperatures).
 * A phase-change piece has lo = hi, iso = true and its heat in q.
 */
export interface Piece {
  lo: number;
  hi: number;
  /** kW/K (0 for a phase-change piece) */
  cp: number;
  /** kW */
  q: number;
  iso: boolean;
  h?: number;
  /** Shifted temperatures */
  sLo: number;
  sHi: number;
}

export interface ResolvedStream {
  id: string;
  name: string;
  kind: 'hot' | 'cold';
  ts: number;
  tt: number;
  /** kW/K; NaN for a non-linear stream (CP varies) */
  cp: number;
  /** Total heat load between supply and target, kW */
  duty: number;
  h?: number;
  nonlinear: boolean;
  /** Profile pieces between supply and target (one piece for a linear stream) */
  pieces: Piece[];
  /** ΔT contribution actually used, K */
  dtc: number;
  /** Shifted supply / target temperatures */
  sTs: number;
  sTt: number;
}

export interface Issue {
  level: 'error' | 'warning';
  /** ID of the stream/utility it concerns, if any */
  ref?: string;
  message: string;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Hot streams shift down, cold streams shift up. */
export function shift(t: number, kind: 'hot' | 'cold', dtc: number): number {
  return kind === 'hot' ? t - dtc : t + dtc;
}

/**
 * Turn user stream input into fully specified streams (CP and duty both known,
 * hot/cold flagged from the temperatures, shifted temperatures computed).
 * Invalid streams are reported and left out.
 */
export function resolveStreams(
  streams: Stream[],
  dtMin: number,
): { resolved: ResolvedStream[]; issues: Issue[] } {
  const resolved: ResolvedStream[] = [];
  const issues: Issue[] = [];
  for (const s of streams) {
    const label = s.name || 'Unnamed stream';
    if (!finite(s.tSupply) || !finite(s.tTarget)) {
      issues.push({ level: 'error', ref: s.id, message: `${label}: supply and target temperatures are required.` });
      continue;
    }
    const dT = Math.abs(s.tSupply - s.tTarget);
    if (dT < EPS) {
      issues.push({
        level: 'error',
        ref: s.id,
        message: `${label}: supply and target temperatures are equal. Isothermal (phase-change) streams are not supported yet; give them a 1 K range.`,
      });
      continue;
    }
    const kind = s.tSupply > s.tTarget ? 'hot' : 'cold';
    const dtc = finite(s.dtCont) && s.dtCont >= 0 ? s.dtCont : dtMin / 2;
    const lo = Math.min(s.tSupply, s.tTarget);
    const hi = Math.max(s.tSupply, s.tTarget);
    const h = finite(s.h) && s.h > 0 ? s.h : undefined;
    const sh = (t: number) => shift(t, kind, dtc);
    let pieces: Piece[];
    let cp: number;
    const nonlinear = s.profile === 'nonlinear';
    if (nonlinear) {
      const res = resolveProfile(s, lo, hi, label);
      if (typeof res === 'string') {
        issues.push({ level: 'error', ref: s.id, message: res });
        continue;
      }
      pieces = res.map((p) => ({ ...p, sLo: sh(p.lo), sHi: sh(p.hi) }));
      cp = NaN;
    } else {
      if (s.spec === 'duty') {
        if (!finite(s.duty) || s.duty <= 0) {
          issues.push({ level: 'error', ref: s.id, message: `${label}: heat load must be a positive number.` });
          continue;
        }
        cp = s.duty / dT;
      } else {
        if (!finite(s.cp) || s.cp <= 0) {
          issues.push({ level: 'error', ref: s.id, message: `${label}: CP must be a positive number.` });
          continue;
        }
        cp = s.cp;
      }
      pieces = [{ lo, hi, cp, q: cp * dT, iso: false, h, sLo: sh(lo), sHi: sh(hi) }];
    }
    const duty = pieces.reduce((sum, p) => sum + p.q, 0);
    resolved.push({
      id: s.id,
      name: label,
      kind,
      ts: s.tSupply,
      tt: s.tTarget,
      cp,
      duty,
      h,
      nonlinear,
      pieces,
      dtc,
      sTs: sh(s.tSupply),
      sTt: sh(s.tTarget),
    });
  }
  return { resolved, issues };
}

export interface ResolvedUtility {
  id: string;
  name: string;
  kind: 'hot' | 'cold';
  ts: number;
  tt: number;
  isothermal: boolean;
  cost: number;
  /** User limit on duty, kW (Infinity when not set) */
  maxDuty: number;
  h?: number;
  dtc: number;
  sTs: number;
  sTt: number;
}

export function resolveUtilities(
  utilities: Utility[],
  dtMin: number,
): { resolved: ResolvedUtility[]; issues: Issue[] } {
  const resolved: ResolvedUtility[] = [];
  const issues: Issue[] = [];
  for (const u of utilities) {
    const label = u.name || 'Unnamed utility';
    if (!finite(u.tSupply) || !finite(u.tTarget)) {
      issues.push({ level: 'error', ref: u.id, message: `${label}: supply and target temperatures are required.` });
      continue;
    }
    if (u.kind === 'hot' && u.tSupply < u.tTarget - EPS) {
      issues.push({ level: 'error', ref: u.id, message: `${label}: a hot utility must cool down (supply ≥ target).` });
      continue;
    }
    if (u.kind === 'cold' && u.tSupply > u.tTarget + EPS) {
      issues.push({ level: 'error', ref: u.id, message: `${label}: a cold utility must heat up (supply ≤ target).` });
      continue;
    }
    const dtc = finite(u.dtCont) && u.dtCont >= 0 ? u.dtCont : dtMin / 2;
    resolved.push({
      id: u.id,
      name: label,
      kind: u.kind,
      ts: u.tSupply,
      tt: u.tTarget,
      isothermal: Math.abs(u.tSupply - u.tTarget) < EPS,
      cost: finite(u.cost) ? u.cost : 0,
      maxDuty: finite(u.maxDuty) && u.maxDuty >= 0 ? u.maxDuty : Infinity,
      h: finite(u.h) && u.h > 0 ? u.h : undefined,
      dtc,
      sTs: shift(u.tSupply, u.kind, dtc),
      sTt: shift(u.tTarget, u.kind, dtc),
    });
  }
  return { resolved, issues };
}

/**
 * Turn a non-linear profile into pieces between the stream's supply and target
 * temperatures. Returns an error message if the profile is unusable.
 */
function resolveProfile(s: Stream, lo: number, hi: number, label: string): Omit<Piece, 'sLo' | 'sHi'>[] | string {
  const pd = s.profileData;
  if (!pd || pd.temps.length < 2) return `${label}: the non-linear profile needs at least two temperature points.`;
  if (pd.segments.length !== pd.temps.length - 1) return `${label}: the non-linear profile is incomplete.`;
  if (pd.temps.some((t) => !finite(t))) return `${label}: every temperature point in the profile needs a value.`;
  const dir = Math.sign(pd.temps[pd.temps.length - 1] - pd.temps[0]);
  if (dir === 0) return `${label}: the profile's first and last temperatures are equal.`;
  for (let k = 1; k < pd.temps.length; k++) {
    if (Math.sign(pd.temps[k] - pd.temps[k - 1]) === -dir) {
      return `${label}: profile temperatures must keep rising or keep falling (point ${k + 1}).`;
    }
  }
  const sh = finite(s.h) && s.h > 0 ? s.h : undefined;
  const pieces: Omit<Piece, 'sLo' | 'sHi'>[] = [];
  for (let k = 0; k < pd.segments.length; k++) {
    const seg = pd.segments[k];
    const a = pd.temps[k];
    const b = pd.temps[k + 1];
    const pl = Math.min(a, b);
    const ph = Math.max(a, b);
    const segH = pd.hConstant ? sh : finite(seg.h) && seg.h > 0 ? seg.h : undefined;
    const where = `segment ${k + 1} (${a}–${b} °C)`;
    if (ph - pl < EPS) {
      // phase change: heat at a single temperature, entered as a heat load
      if (!finite(seg.duty) || seg.duty <= 0) return `${label}: phase-change ${where} needs a positive heat load.`;
      if (pl >= lo - EPS && pl <= hi + EPS) pieces.push({ lo: pl, hi: pl, cp: 0, q: seg.duty, iso: true, h: segH });
      continue;
    }
    let cp: number;
    if (seg.spec === 'duty') {
      if (!finite(seg.duty) || seg.duty <= 0) return `${label}: ${where} needs a positive heat load.`;
      cp = seg.duty / (ph - pl);
    } else {
      if (!finite(seg.cp) || seg.cp <= 0) return `${label}: ${where} needs a positive CP.`;
      cp = seg.cp;
    }
    const cl = Math.max(pl, lo);
    const ch = Math.min(ph, hi);
    if (ch - cl > EPS) pieces.push({ lo: cl, hi: ch, cp, q: cp * (ch - cl), iso: false, h: segH });
  }
  // the profile must cover the whole supply–target range
  const ranges = pieces.filter((p) => !p.iso).sort((x, y) => x.lo - y.lo);
  let reach = lo;
  for (const r of ranges) {
    if (r.lo > reach + EPS) return `${label}: the profile does not cover ${reach}–${r.lo} °C.`;
    reach = Math.max(reach, r.hi);
  }
  if (reach < hi - EPS) return `${label}: the profile does not cover ${reach}–${hi} °C.`;
  return pieces;
}
