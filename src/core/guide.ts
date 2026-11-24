/**
 * Design guide: suggests the next exchanger matches using the pinch design
 * method heuristics (Linnhoff & Hindmarsh, 1983):
 *  1. Start at the pinch and work away from it, above and below separately.
 *  2. Pinch matches must satisfy the CP rule: above, CP hot ≤ CP cold; below, CP hot ≥ CP cold.
 *  3. Number rule at the pinch: above, N hot ≤ N cold; below, N hot ≥ N cold (otherwise split).
 *  4. Tick off: give each match the largest load possible (the smaller remaining duty).
 *  5. Away from the pinch the choice is free, as long as ΔT ≥ ΔTmin.
 *  6. No heaters below the pinch and no coolers above it.
 * Every suggestion is checked by trying it on a copy of the network.
 */
import type { NetUnit, Project } from './types';
import type { Analysis } from './analyse';
import { analyseNetwork, PINCH_X, profileOf, type NetworkResult } from './network';
import type { ResolvedStream } from './streams';

export type Region = 'above' | 'below';

export interface Suggestion {
  region: Region;
  hot: string;
  cold: string;
  load: number;
  x: number;
  pinchMatch: boolean;
  /** CP of each stream at the pinch end of the match (kW/K) */
  cpHot: number;
  cpCold: number;
  /** Streams whose remaining heat on this side this match ticks off */
  ticksOff: string[];
  /** Smallest ΔT of the new exchanger once placed, K */
  dt: number;
  feasible: boolean;
  /** Why it is not feasible (when feasible = false) */
  problem?: string;
}

export interface RegionGuide {
  region: Region;
  /** Unmatched heat on this side, by stream */
  remainingHot: number;
  remainingCold: number;
  /** Streams that still need their pinch match */
  pinchHot: string[];
  pinchCold: string[];
  /** Number rule satisfied for the streams still needing a pinch match */
  numberRuleOk: boolean;
  suggestions: Suggestion[];
}

export interface Guide {
  pinch: boolean;
  regions: RegionGuide[];
}

const TOL = 1e-6;

export function designGuide(project: Project, analysis: Analysis, net: NetworkResult): Guide {
  const pinch = analysis.pt.pinches[0];
  const units = project.network?.units ?? [];
  const hots = analysis.streams.filter((s) => s.kind === 'hot');
  const colds = analysis.streams.filter((s) => s.kind === 'cold');
  const regions: Region[] = pinch === undefined ? ['above'] : ['above', 'below'];

  const out: RegionGuide[] = regions.map((region) => {
    const isAbove = region === 'above' || pinch === undefined;
    const inRegion = (u: NetUnit) => (pinch === undefined ? true : isAbove ? u.x < PINCH_X : u.x >= PINCH_X);
    const rem = (s: ResolvedStream) => {
      const sr = net.streams.get(s.id);
      if (!sr) return 0;
      if (pinch === undefined) return sr.remaining;
      return isAbove ? sr.remainingAbove : sr.remainingBelow;
    };
    const touchesPinch = (s: ResolvedStream) => {
      if (pinch === undefined) return false;
      const sr = net.streams.get(s.id)!;
      const duty = profileOf(s).duty;
      const aboveQ = s.kind === 'hot' ? sr.pinchQ : duty - sr.pinchQ;
      const belowQ = duty - aboveQ;
      // the stream exists on both sides of the pinch, or starts/ends exactly there
      return isAbove ? aboveQ > TOL && (belowQ > TOL || atPinch(s, pinch)) : belowQ > TOL && (aboveQ > TOL || atPinch(s, pinch));
    };
    const unitsOn = (s: ResolvedStream) => units.filter((u) => inRegion(u) && (s.kind === 'hot' ? u.hot === s.id : u.cold === s.id) && u.kind === 'exchanger');
    const needsPinch = (s: ResolvedStream) => touchesPinch(s) && rem(s) > TOL && unitsOn(s).length === 0;

    const pinchHot = hots.filter(needsPinch).map((s) => s.id);
    const pinchCold = colds.filter(needsPinch).map((s) => s.id);
    const numberRuleOk = isAbove ? pinchHot.length <= pinchCold.length : pinchHot.length >= pinchCold.length;

    const suggestions: Suggestion[] = [];
    for (const h of hots) {
      if (rem(h) <= TOL) continue;
      for (const c of colds) {
        if (rem(c) <= TOL) continue;
        const pinchMatch = pinch !== undefined && pinchHot.includes(h.id) && pinchCold.includes(c.id);
        const load = Math.min(rem(h), rem(c));
        const x = placeX(units, h.id, c.id, isAbove, pinchMatch, pinch === undefined);
        const trial: NetUnit = { id: '__guide__', kind: 'exchanger', hot: h.id, cold: c.id, load, x };
        const tNet = analyseNetwork({ ...project, network: { units: [...units, trial] } }, analysis, 'pinch');
        const r = tNet.units.find((u) => u.id === '__guide__')!;
        const dt = Math.min(r.dtHot, r.dtCold);
        const ph = profileOf(h);
        const pc = profileOf(c);
        const hq0 = r.hotIn !== undefined ? ph.heatTo(r.hotIn) : 0;
        const cq0 = pc.heatTo(r.coldIn);
        // CP at the pinch end: above, hot leaves and cold enters at the pinch; below, the reverse
        const cpHot = isAbove ? ph.cpAt(Math.max(0, hq0 + load - 1e-9)) : ph.cpAt(hq0);
        const cpCold = isAbove ? pc.cpAt(cq0) : pc.cpAt(Math.max(0, cq0 + load - 1e-9));
        let problem: string | undefined;
        if (!(dt >= analysis.dtMin - 1e-6)) problem = `ΔT would be ${fmt(dt)} K, below ΔTmin`;
        if (pinchMatch && (isAbove ? cpHot > cpCold + 1e-9 : cpHot + 1e-9 < cpCold)) {
          problem = `CP rule fails at the pinch (${fmt(cpHot)} ${isAbove ? '>' : '<'} ${fmt(cpCold)})`;
        }
        const ticksOff = [h, c].filter((s) => Math.abs(rem(s) - load) < TOL).map((s) => s.id);
        suggestions.push({ region, hot: h.id, cold: c.id, load, x, pinchMatch, cpHot, cpCold, ticksOff, dt, feasible: !problem, problem });
      }
    }
    // Pinch matches first (the method starts at the pinch), then the rest; feasible before infeasible; larger loads first.
    const pinchPhase = pinchHot.length > 0 && pinchCold.length > 0;
    const shown = pinchPhase ? suggestions.filter((s) => s.pinchMatch) : suggestions;
    shown.sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.load - a.load);
    return {
      region,
      remainingHot: hots.reduce((t, s) => t + Math.max(0, rem(s)), 0),
      remainingCold: colds.reduce((t, s) => t + Math.max(0, rem(s)), 0),
      pinchHot,
      pinchCold,
      numberRuleOk,
      suggestions: shown,
    };
  });
  return { pinch: pinch !== undefined, regions: out };
}

function atPinch(s: ResolvedStream, pinch: number): boolean {
  const pT = s.kind === 'hot' ? pinch + s.dtc : pinch - s.dtc;
  return Math.abs(s.ts - pT) < 1e-6 || Math.abs(s.tt - pT) < 1e-6;
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
