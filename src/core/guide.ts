/**
 * Design guide: suggests the next exchanger matches (and stream splits) using
 * the pinch design method heuristics (Linnhoff & Hindmarsh, 1983):
 *  1. Start at the pinch and work away from it, above and below separately.
 *  2. Pinch matches must satisfy the CP rule: above, CP hot ≤ CP cold; below, CP hot ≥ CP cold.
 *  3. Number rule at the pinch: above, N hot ≤ N cold; below, N hot ≥ N cold (otherwise split).
 *  4. Tick off: give each match the largest load possible (the smaller remaining duty).
 *  5. Away from the pinch the choice is free, as long as ΔT ≥ ΔTmin.
 *  6. No heaters below the pinch and no coolers above it.
 * A split stream takes part branch by branch. Every match suggestion is
 * checked by trying it on a copy of the network.
 */
import type { NetUnit, Project } from './types';
import type { Analysis } from './analyse';
import { analyseNetwork, PINCH_X, profileOf, regionOf, type NetworkResult, type Region } from './network';
import type { ResolvedStream } from './streams';

export type { Region };

export interface Suggestion {
  region: Region;
  hot: string;
  cold: string;
  /** Branch of a split stream (undefined when that stream is not split on this side) */
  hotBranch?: number;
  coldBranch?: number;
  load: number;
  x: number;
  pinchMatch: boolean;
  /** CP of each side at the pinch end of the match (kW/K; a branch's own CP) */
  cpHot: number;
  cpCold: number;
  /** Streams/branches this match finishes on this side, as labels like "s1" or "s1#2" */
  ticksOff: string[];
  /** Smallest ΔT of the new exchanger once placed, K */
  dt: number;
  feasible: boolean;
  /** Why it is not feasible (when feasible = false) */
  problem?: string;
}

export interface SplitSuggestion {
  region: Region;
  stream: string;
  fractions: number[];
  /** CP of each branch, kW/K */
  cps: number[];
  reason: string;
}

export interface RegionGuide {
  region: Region;
  /** Unmatched heat on this side */
  remainingHot: number;
  remainingCold: number;
  /** Streams that still need their pinch match */
  pinchHot: string[];
  pinchCold: string[];
  /** Number rule satisfied for the ends (streams or branches) still needing a pinch match */
  numberRuleOk: boolean;
  /** A split that would make the pinch matches possible */
  split?: SplitSuggestion;
  suggestions: Suggestion[];
}

export interface Guide {
  pinch: boolean;
  regions: RegionGuide[];
}

const TOL = 1e-6;

/** One end to match: a whole stream, or one branch of a stream split on this side. */
interface End {
  s: ResolvedStream;
  branch?: number;
  fraction: number;
  rem: number;
  /** Needs its pinch match (touches the pinch, unmatched there) */
  needsPinch: boolean;
  /** CP at the pinch end */
  cp: number;
}

export function designGuide(project: Project, analysis: Analysis, net: NetworkResult): Guide {
  const pinch = analysis.pt.pinches[0];
  const hasPinch = pinch !== undefined;
  const units = project.network?.units ?? [];
  const regions: Region[] = hasPinch ? ['above', 'below'] : ['above'];

  const out: RegionGuide[] = regions.map((region) => {
    const isAbove = region === 'above';
    const inRegion = (u: NetUnit) => regionOf(u.x, hasPinch) === region;

    const ends = (kind: 'hot' | 'cold'): End[] => {
      const list: End[] = [];
      for (const s of analysis.streams.filter((x) => x.kind === kind)) {
        const sr = net.streams.get(s.id);
        if (!sr) continue;
        const prof = profileOf(s);
        const touches = touchesPinch(s, sr.pinchQ, prof.duty, isAbove, pinch);
        // CP at the pinch end of this side
        const qEnd = kind === 'hot' ? (isAbove ? Math.max(0, sr.pinchQ - 1e-9) : sr.pinchQ) : isAbove ? sr.pinchQ : Math.max(0, sr.pinchQ - 1e-9);
        const cpEnd = prof.cpAt(qEnd);
        const mine = units.filter((u) => inRegion(u) && u.kind === 'exchanger' && (kind === 'hot' ? u.hot === s.id : u.cold === s.id));
        const br = sr.branches?.[region];
        if (br) {
          br.forEach((b, k) => {
            const onBranch = mine.filter((u) => ((kind === 'hot' ? u.hotBranch : u.coldBranch) ?? 0) === k);
            list.push({ s, branch: k, fraction: b.fraction, rem: b.remaining, needsPinch: touches && b.remaining > TOL && onBranch.length === 0, cp: cpEnd * b.fraction });
          });
        } else {
          const rem = !hasPinch ? sr.remaining : isAbove ? sr.remainingAbove : sr.remainingBelow;
          list.push({ s, fraction: 1, rem, needsPinch: touches && rem > TOL && mine.length === 0, cp: cpEnd });
        }
      }
      return list;
    };
    const hotEnds = ends('hot');
    const coldEnds = ends('cold');
    const pinchHotEnds = hotEnds.filter((e) => e.needsPinch);
    const pinchColdEnds = coldEnds.filter((e) => e.needsPinch);
    const numberRuleOk = isAbove ? pinchHotEnds.length <= pinchColdEnds.length : pinchHotEnds.length >= pinchColdEnds.length;
    const pinchPhase = hasPinch && pinchHotEnds.length > 0 && pinchColdEnds.length > 0;

    const suggestions: Suggestion[] = [];
    for (const h of hotEnds) {
      if (h.rem <= TOL) continue;
      for (const c of coldEnds) {
        if (c.rem <= TOL) continue;
        const pinchMatch = hasPinch && h.needsPinch && c.needsPinch;
        const load = Math.min(h.rem, c.rem);
        const x = placeX(units, h.s.id, c.s.id, isAbove, pinchMatch, !hasPinch);
        const trial: NetUnit = { id: '__guide__', kind: 'exchanger', hot: h.s.id, cold: c.s.id, load, x, hotBranch: h.branch, coldBranch: c.branch };
        const tNet = analyseNetwork({ ...project, network: { ...project.network, units: [...units, trial] } }, analysis, 'pinch');
        const r = tNet.units.find((u) => u.id === '__guide__')!;
        const dt = Math.min(r.dtHot, r.dtCold);
        const ph = profileOf(h.s);
        const pc = profileOf(c.s);
        // stream-equivalent Q at the inlet of each side, then the pinch end of the match
        const hq0 = ph.heatTo(r.hotIn);
        const cq0 = pc.heatTo(r.coldIn);
        const cpHot = (isAbove ? ph.cpAt(Math.max(0, hq0 + load / h.fraction - 1e-9)) : ph.cpAt(hq0)) * h.fraction;
        const cpCold = (isAbove ? pc.cpAt(cq0) : pc.cpAt(Math.max(0, cq0 + load / c.fraction - 1e-9))) * c.fraction;
        let problem: string | undefined;
        if (!(dt >= analysis.dtMin - 1e-6)) problem = `ΔT would be ${fmt(dt)} K, below ΔTmin`;
        if (pinchMatch && (isAbove ? cpHot > cpCold + 1e-9 : cpHot + 1e-9 < cpCold)) {
          problem = `CP rule fails at the pinch (${fmt(cpHot)} ${isAbove ? '>' : '<'} ${fmt(cpCold)})`;
        }
        const ticksOff = [h, c].filter((e) => Math.abs(e.rem - load) < TOL).map(endKey);
        suggestions.push({ region, hot: h.s.id, cold: c.s.id, hotBranch: h.branch, coldBranch: c.branch, load, x, pinchMatch, cpHot, cpCold, ticksOff, dt, feasible: !problem, problem });
      }
    }
    // Pinch matches first (the method starts at the pinch), then the rest; feasible before infeasible; larger loads first.
    const shown = pinchPhase ? suggestions.filter((s) => s.pinchMatch) : suggestions;
    shown.sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.load - a.load);

    const split = pinchPhase || (hasPinch && !numberRuleOk) ? suggestSplit(region, pinchHotEnds, pinchColdEnds, project) : undefined;

    return {
      region,
      remainingHot: hotEnds.reduce((t, e) => t + Math.max(0, e.rem), 0),
      remainingCold: coldEnds.reduce((t, e) => t + Math.max(0, e.rem), 0),
      pinchHot: [...new Set(pinchHotEnds.map((e) => e.s.id))],
      pinchCold: [...new Set(pinchColdEnds.map((e) => e.s.id))],
      numberRuleOk,
      split,
      suggestions: shown,
    };
  });
  return { pinch: hasPinch, regions: out };
}

/** "s1" for a whole stream, "s1#2" for branch 2 (1-based). */
export function endKey(e: { s: { id: string }; branch?: number }): string {
  return e.branch === undefined ? e.s.id : `${e.s.id}#${e.branch + 1}`;
}

function touchesPinch(s: ResolvedStream, pinchQ: number, duty: number, isAbove: boolean, pinch: number | undefined): boolean {
  if (pinch === undefined) return false;
  const aboveQ = s.kind === 'hot' ? pinchQ : duty - pinchQ;
  const belowQ = duty - aboveQ;
  return isAbove ? aboveQ > TOL && (belowQ > TOL || atPinch(s, pinch)) : belowQ > TOL && (aboveQ > TOL || atPinch(s, pinch));
}

function atPinch(s: ResolvedStream, pinch: number): boolean {
  const pT = s.kind === 'hot' ? pinch + s.dtc : pinch - s.dtc;
  return Math.abs(s.ts - pT) < 1e-6 || Math.abs(s.tt - pT) < 1e-6;
}

/**
 * Suggest one split that moves the pinch design forward. On each side the
 * "small" ends (hot above the pinch, cold below) must each get their own "big"
 * partner with at least the same CP. Candidates, in order:
 *  1. split a big-side stream into a branch sized to a small stream's CP and the rest,
 *     if that makes every pinch match possible (the usual textbook split);
 *  2. otherwise split the small-side stream whose CP is too large so one branch fits.
 * Only streams not yet split on this side are proposed.
 */
function suggestSplit(region: Region, hot: End[], cold: End[], project: Project): SplitSuggestion | undefined {
  if ([...hot, ...cold].some((e) => !Number.isFinite(e.cp) || !(e.cp > 0))) return undefined;
  const above = region === 'above';
  const small = above ? hot : cold;
  const big = above ? cold : hot;
  const feasible = (sm: number[], bg: number[]) => {
    if (sm.length > bg.length) return false;
    const a = [...sm].sort((x, y) => y - x);
    const b = [...bg].sort((x, y) => y - x);
    return a.every((v, i) => v <= b[i] + 1e-9);
  };
  if (feasible(small.map((e) => e.cp), big.map((e) => e.cp))) return undefined;
  const isSplit = (e: End) => e.branch !== undefined || !!project.network?.splits?.some((sp) => sp.stream === e.s.id && sp.side === region);
  const make = (e: End, cps: number[], reason: string): SplitSuggestion => ({
    region,
    stream: e.s.id,
    fractions: cps.map((c) => c / e.cp),
    cps,
    reason,
  });
  const countReason = above
    ? `${small.length} hot and ${big.length} cold streams at the pinch: each hot stream needs its own cold partner.`
    : `${big.length} hot and ${small.length} cold streams at the pinch: each cold stream needs its own hot partner.`;
  const cpReason = (who: string) =>
    above ? `No way to give every hot stream a cold partner with CP at least as large; splitting ${who} fixes that.` : `No way to give every cold stream a hot partner with CP at least as large; splitting ${who} fixes that.`;
  const reason = (who: string) => (small.length > big.length ? countReason : cpReason(who));

  // 1. split a big-side stream: one branch sized to a small stream's CP, the rest kept
  for (const B of [...big].sort((x, y) => y.cp - x.cp)) {
    if (isSplit(B)) continue;
    for (const S of [...small].sort((x, y) => y.cp - x.cp)) {
      const rest = B.cp - S.cp;
      if (!(rest > 0.02 * B.cp)) continue;
      const bg = big.filter((e) => e !== B).map((e) => e.cp).concat([S.cp, rest]);
      if (feasible(small.map((e) => e.cp), bg)) return make(B, [S.cp, rest], reason(B.s.name));
    }
  }
  // 2. split the small-side stream whose CP is too large, so one branch fits the largest free partner
  const sm = [...small].sort((x, y) => y.cp - x.cp);
  const bg = [...big].sort((x, y) => y.cp - x.cp);
  for (let i = 0; i < sm.length; i++) {
    const partner = bg[i];
    if (partner && sm[i].cp <= partner.cp + 1e-9) continue;
    const e = sm[i];
    if (isSplit(e)) return undefined;
    const fit = partner ? partner.cp : e.cp / 2;
    const rest = e.cp - fit;
    if (!(rest > 0.02 * e.cp)) return undefined;
    return make(e, [fit, rest], above ? `${e.s.name} (CP ${fmt(e.cp)}) is larger than any free cold stream at the pinch, so the CP rule cannot be met.` : `${e.s.name} (CP ${fmt(e.cp)}) is larger than any free hot stream at the pinch, so the CP rule cannot be met.`);
  }
  // counts too low on the big side and no single split fixes the CPs: split the largest big stream in two
  const B = bg.find((e) => !isSplit(e));
  return B ? make(B, [B.cp / 2, B.cp / 2], countReason) : undefined;
}

/**
 * Where to place a new match: pinch matches next to the pinch (closer to it
 * than any existing unit on the two streams), other matches beyond the
 * existing units, away from the pinch.
 */
function placeX(units: NetUnit[], hot: string, cold: string, above: boolean, pinchMatch: boolean, noPinch: boolean): number {
  const xs = units.filter((u) => u.hot === hot || u.cold === cold).map((u) => u.x);
  if (noPinch) {
    const max = xs.length ? Math.max(...xs) : 0.3;
    return +Math.min(0.95, max + 0.08).toFixed(4);
  }
  const side = xs.filter((x) => (above ? x < PINCH_X : x >= PINCH_X));
  if (above) {
    if (pinchMatch) return +((Math.max(0.3, ...side) + PINCH_X) / 2).toFixed(4);
    const min = side.length ? Math.min(...side) : 0.4;
    return +Math.max(0.04, min - 0.07).toFixed(4);
  }
  if (pinchMatch) return +((Math.min(0.7, ...side) + PINCH_X) / 2).toFixed(4);
  const max = side.length ? Math.max(...side) : 0.6;
  return +Math.min(0.96, max + 0.07).toFixed(4);
}

function fmt(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toLocaleString('en', { maximumFractionDigits: 2 });
}
