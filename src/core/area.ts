import { EPS, type ResolvedStream, type ResolvedUtility } from './streams';
import type { UtilityTarget } from './utilities';
import { uniqueAsc, type Point } from './composites';

/** A participant in a balanced composite curve. */
interface Member {
  id: string;
  isUtility: boolean;
  h?: number;
  lo: number;
  hi: number;
  /** CP for ranged members, kW/K */
  cp: number;
  /** Duty for isothermal members, kW */
  q: number;
  isothermal: boolean;
}

interface Segment {
  h0: number;
  h1: number;
  t0: number;
  t1: number;
  /** Share of the segment's heat carried by each member */
  shares: { m: Member; frac: number }[];
}

function segments(members: Member[]): Segment[] {
  if (members.length === 0) return [];
  const temps = uniqueAsc(members.flatMap((m) => [m.lo, m.hi]));
  const segs: Segment[] = [];
  let h = 0;
  for (let i = 0; i < temps.length; i++) {
    const t = temps[i];
    if (i > 0) {
      const a = temps[i - 1];
      const active = members.filter((m) => !m.isothermal && m.lo <= a + EPS && m.hi >= t - EPS);
      const cp = active.reduce((s, m) => s + m.cp, 0);
      if (cp > 0) {
        const dh = cp * (t - a);
        segs.push({ h0: h, h1: h + dh, t0: a, t1: t, shares: active.map((m) => ({ m, frac: m.cp / cp })) });
        h += dh;
      }
    }
    const iso = members.filter((m) => m.isothermal && Math.abs(m.lo - t) < EPS && m.q > 0);
    const q = iso.reduce((s, m) => s + m.q, 0);
    if (q > 0) {
      segs.push({ h0: h, h1: h + q, t0: t, t1: t, shares: iso.map((m) => ({ m, frac: m.q / q })) });
      h += q;
    }
  }
  return segs;
}

function tempAt(seg: Segment, h: number): number {
  if (seg.h1 - seg.h0 < 1e-12) return seg.t0;
  return seg.t0 + ((seg.t1 - seg.t0) * (h - seg.h0)) / (seg.h1 - seg.h0);
}

function find(segs: Segment[], h: number): Segment | undefined {
  return segs.find((s) => h >= s.h0 - 1e-9 && h <= s.h1 + 1e-9);
}

export interface AreaTarget {
  /** Total area, m². null when data are missing. Infinity when ΔT ≤ 0 somewhere. */
  total: number | null;
  /** Approximate split by unit type (see docs) */
  exchanger: number;
  heater: number;
  cooler: number;
  /** Streams/utilities without a film coefficient */
  missingH: string[];
  /** True if the balanced curves cross or touch (ΔT ≤ 0) */
  infeasible: boolean;
  /** Balanced composites (actual temperatures), for display */
  hotCurve: Point[];
  coldCurve: Point[];
}

function membersFromStream(s: ResolvedStream): Member[] {
  return s.pieces.map((p) => ({ id: s.id, isUtility: false, h: p.h, lo: p.lo, hi: p.hi, cp: p.cp, q: p.q, isothermal: p.iso }));
}

function memberFromUtility(u: ResolvedUtility, duty: number): Member {
  const lo = Math.min(u.ts, u.tt);
  const hi = Math.max(u.ts, u.tt);
  return { id: u.id, isUtility: true, h: u.h, lo, hi, cp: u.isothermal ? 0 : duty / (hi - lo), q: duty, isothermal: u.isothermal };
}

function curvePoints(segs: Segment[]): Point[] {
  if (segs.length === 0) return [];
  const pts: Point[] = [{ h: segs[0].h0, t: segs[0].t0 }];
  for (const s of segs) {
    const last = pts[pts.length - 1];
    if (Math.abs(last.h - s.h0) > 1e-9 || Math.abs(last.t - s.t0) > 1e-9) pts.push({ h: s.h0, t: s.t0 });
    pts.push({ h: s.h1, t: s.t1 });
  }
  return pts;
}

/**
 * Area target by the Bath formula (Townsend & Linnhoff, 1984), assuming vertical
 * (counter-current, "spaghetti") heat transfer between the balanced composite
 * curves:  A = Σ_k (1/ΔT_LM,k) · Σ_i (q_i,k / h_i)
 *
 * The split into exchanger / heater / cooler area attributes each enthalpy
 * interval's area in proportion to the utility share of heat on each side.
 * This is an approximation used only by the "separate parameters" cost model.
 */
export function areaTarget(
  streams: ResolvedStream[],
  utilities: ResolvedUtility[],
  targets: UtilityTarget[],
): AreaTarget {
  const duty = new Map(targets.map((t) => [t.id, t.duty]));
  const hotMembers: Member[] = streams.filter((s) => s.kind === 'hot').flatMap(membersFromStream);
  const coldMembers: Member[] = streams.filter((s) => s.kind === 'cold').flatMap(membersFromStream);
  for (const u of utilities) {
    const q = duty.get(u.id) ?? 0;
    if (q <= 0) continue;
    (u.kind === 'hot' ? hotMembers : coldMembers).push(memberFromUtility(u, q));
  }
  const hotSegs = segments(hotMembers);
  const coldSegs = segments(coldMembers);
  const result: AreaTarget = {
    total: null,
    exchanger: 0,
    heater: 0,
    cooler: 0,
    missingH: [...new Set([...hotMembers, ...coldMembers].filter((m) => m.h === undefined).map((m) => m.id))],
    infeasible: false,
    hotCurve: curvePoints(hotSegs),
    coldCurve: curvePoints(coldSegs),
  };
  if (hotSegs.length === 0 || coldSegs.length === 0) {
    result.total = 0;
    return result;
  }
  const hotEnd = hotSegs[hotSegs.length - 1].h1;
  const coldEnd = coldSegs[coldSegs.length - 1].h1;
  // Curves are unbalanced if some utility demand was unmet; then no meaningful area.
  if (Math.abs(hotEnd - coldEnd) > 1e-6 * Math.max(1, hotEnd)) return result;
  if (result.missingH.length > 0) return result;

  const hs = uniqueAsc([...hotSegs, ...coldSegs].flatMap((s) => [s.h0, s.h1]));
  let total = 0;
  for (let i = 1; i < hs.length; i++) {
    const h1 = hs[i - 1];
    const h2 = hs[i];
    const dH = h2 - h1;
    if (dH < 1e-9) continue;
    const mid = (h1 + h2) / 2;
    const hSeg = find(hotSegs, mid);
    const cSeg = find(coldSegs, mid);
    if (!hSeg || !cSeg) continue;
    const dT1 = tempAt(hSeg, h1) - tempAt(cSeg, h1);
    const dT2 = tempAt(hSeg, h2) - tempAt(cSeg, h2);
    if (dT1 <= 1e-9 || dT2 <= 1e-9) {
      result.infeasible = true;
      result.total = Infinity;
      return result;
    }
    const lmtd = Math.abs(dT1 - dT2) < 1e-9 ? (dT1 + dT2) / 2 : (dT1 - dT2) / Math.log(dT1 / dT2);
    let sumQoverH = 0;
    let uHot = 0;
    let uCold = 0;
    for (const { m, frac } of hSeg.shares) {
      sumQoverH += (dH * frac) / (m.h as number);
      if (m.isUtility) uHot += frac;
    }
    for (const { m, frac } of cSeg.shares) {
      sumQoverH += (dH * frac) / (m.h as number);
      if (m.isUtility) uCold += frac;
    }
    const a = sumQoverH / lmtd;
    total += a;
    const uSum = uHot + uCold;
    const scale = uSum > 1 ? 1 / uSum : 1;
    result.heater += a * uHot * scale;
    result.cooler += a * uCold * scale;
    result.exchanger += a * (1 - uSum * scale);
  }
  result.total = total;
  return result;
}
