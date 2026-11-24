import type { NetUnit, Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import { regionOf, tickOffLoad, type NetworkResult } from '../core/network';
import { newId } from '../core/project';
import { streamSpan } from './GridDiagram';

/** Pick a utility for a heater/cooler: the least extreme one that still gives ΔTmin at the stream's target. */
export function chooseUtility(analysis: Analysis, streamId: string): string | undefined {
  const s = analysis.streams.find((x) => x.id === streamId);
  if (!s) return undefined;
  if (s.kind === 'cold') {
    const hot = analysis.utilities.filter((u) => u.kind === 'hot').sort((a, b) => Math.min(a.ts, a.tt) - Math.min(b.ts, b.tt));
    return (hot.find((u) => Math.min(u.ts, u.tt) >= s.tt + analysis.dtMin - 1e-9) ?? hot[hot.length - 1])?.id;
  }
  const cold = analysis.utilities.filter((u) => u.kind === 'cold').sort((a, b) => Math.max(b.ts, b.tt) - Math.max(a.ts, a.tt));
  return (cold.find((u) => Math.max(u.ts, u.tt) <= s.tt - analysis.dtMin + 1e-9) ?? cold[cold.length - 1])?.id;
}

/**
 * Heaters (cold stream) or coolers (hot stream) for the stream's remaining duty, placed at its target end:
 * one unit, or one per branch with duty left when the stream is split on that side.
 */
export function utilityUnitsFor(analysis: Analysis, net: NetworkResult, streamId: string): NetUnit[] {
  const s = analysis.streams.find((x) => x.id === streamId);
  const sr = net.streams.get(streamId);
  if (!s || !sr) return [];
  const load = utilityDuty(analysis, net, streamId);
  if (load <= 1e-9) return [];
  const [a, b] = streamSpan(s, analysis.pt.pinches[0]);
  const utility = chooseUtility(analysis, streamId);
  if (!utility) return [];
  const x = s.kind === 'cold' ? +(a + 0.03).toFixed(4) : +(b - 0.03).toFixed(4);
  const make = (l: number, branch?: number): NetUnit =>
    s.kind === 'cold'
      ? { id: newId('h'), kind: 'heater', cold: s.id, utility, load: +l.toFixed(6), x, coldBranch: branch }
      : { id: newId('c'), kind: 'cooler', hot: s.id, utility, load: +l.toFixed(6), x, hotBranch: branch };
  const br = sr.branches?.[regionOf(x, net.hasPinch)];
  if (br) {
    // on branches, keep clear of where the branches rejoin the stream line
    const xb = s.kind === 'cold' ? +(a + 0.07).toFixed(4) : +(b - 0.07).toFixed(4);
    return br.map((bb, k) => (bb.remaining > 1e-9 ? { ...make(bb.remaining, k), x: xb } : null)).filter((u): u is NetUnit => u !== null);
  }
  return [make(load)];
}

/** A new exchanger between two streams at x, loaded by the tick-off heuristic. */
export function exchangerFor(analysis: Analysis, net: NetworkResult, hot: string, cold: string, x: number, hotBranch?: number, coldBranch?: number): NetUnit {
  const pinch = analysis.pt.pinches[0];
  const hs = analysis.streams.find((s) => s.id === hot)!;
  const cs = analysis.streams.find((s) => s.id === cold)!;
  const [ha, hb] = streamSpan(hs, pinch);
  const [ca, cb] = streamSpan(cs, pinch);
  const lo = Math.max(ha, ca) + 0.01;
  const hi = Math.min(hb, cb) - 0.01;
  const xx = lo <= hi ? Math.min(hi, Math.max(lo, x)) : x;
  // keep a branch only where that stream is split
  const reg = regionOf(xx, net.hasPinch);
  const hBr = net.streams.get(hot)?.branches?.[reg] ? (hotBranch ?? 0) : undefined;
  const cBr = net.streams.get(cold)?.branches?.[reg] ? (coldBranch ?? 0) : undefined;
  return { id: newId('e'), kind: 'exchanger', hot, cold, load: +tickOffLoad(net, hot, cold, xx, hBr, cBr).toFixed(6), x: +xx.toFixed(4), hotBranch: hBr, coldBranch: cBr };
}

export function networkUnits(p: Project): NetUnit[] {
  return p.network?.units ?? [];
}

/**
 * Duty a heater or cooler should take: heaters only above the pinch (cold
 * streams' unmatched heat there), coolers only below it (hot streams' unmatched
 * heat there). Without a pinch, the whole remaining duty.
 */
export function utilityDuty(analysis: Analysis, net: NetworkResult, streamId: string): number {
  const s = analysis.streams.find((x) => x.id === streamId);
  const sr = net.streams.get(streamId);
  if (!s || !sr) return 0;
  if (analysis.pt.pinches.length === 0) return Math.max(0, sr.remaining);
  return Math.max(0, s.kind === 'cold' ? sr.remainingAbove : sr.remainingBelow);
}
