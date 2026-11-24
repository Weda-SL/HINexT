import type { NetUnit, Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import { tickOffLoad, type NetworkResult } from '../core/network';
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

/** A heater (cold stream) or cooler (hot stream) for the stream's remaining duty, placed at its target end. */
export function utilityUnitFor(analysis: Analysis, net: NetworkResult, streamId: string): NetUnit | null {
  const s = analysis.streams.find((x) => x.id === streamId);
  const sr = net.streams.get(streamId);
  if (!s || !sr || sr.remaining <= 1e-9) return null;
  const [a, b] = streamSpan(s, analysis.pt.pinches[0]);
  const utility = chooseUtility(analysis, streamId);
  if (!utility) return null;
  return s.kind === 'cold'
    ? { id: newId('h'), kind: 'heater', cold: s.id, utility, load: +sr.remaining.toFixed(6), x: +(a + 0.03).toFixed(4) }
    : { id: newId('c'), kind: 'cooler', hot: s.id, utility, load: +sr.remaining.toFixed(6), x: +(b - 0.03).toFixed(4) };
}

/** A new exchanger between two streams at x, loaded by the tick-off heuristic. */
export function exchangerFor(analysis: Analysis, net: NetworkResult, hot: string, cold: string, x: number): NetUnit {
  const pinch = analysis.pt.pinches[0];
  const hs = analysis.streams.find((s) => s.id === hot)!;
  const cs = analysis.streams.find((s) => s.id === cold)!;
  const [ha, hb] = streamSpan(hs, pinch);
  const [ca, cb] = streamSpan(cs, pinch);
  const lo = Math.max(ha, ca) + 0.01;
  const hi = Math.min(hb, cb) - 0.01;
  const xx = lo <= hi ? Math.min(hi, Math.max(lo, x)) : x;
  return { id: newId('e'), kind: 'exchanger', hot, cold, load: +tickOffLoad(net, hot, cold, xx).toFixed(6), x: +xx.toFixed(4) };
}

export function networkUnits(p: Project): NetUnit[] {
  return p.network?.units ?? [];
}
