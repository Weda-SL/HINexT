import { EPS, type ResolvedStream } from './streams';
import type { ProblemTable } from './cascade';
import type { UtilityTarget } from './utilities';

export interface UnitsTarget {
  /** Euler minimum ignoring the pinch: N − 1 */
  overall: number;
  /** Minimum units for an MER network: Σ over pinch regions of (N_region − 1) */
  mer: number;
  /** Count of streams (incl. utilities used) in each region, top region first */
  regions: { tTop: number; tBot: number; count: number }[];
  hotUtilitiesUsed: number;
  coldUtilitiesUsed: number;
}

/**
 * Minimum number of units (Hohmann 1971; Linnhoff et al. 1982).
 * For an MER design the pinch splits the problem into independent regions,
 * each needing (N − 1) units. Hot utilities sit above the highest pinch,
 * cold utilities below the lowest.
 */
export function unitsTarget(streams: ResolvedStream[], pt: ProblemTable, utilities: UtilityTarget[]): UnitsTarget {
  const used = utilities.filter((u) => u.duty > 0);
  const nHotU = used.filter((u) => u.kind === 'hot').length;
  const nColdU = used.filter((u) => u.kind === 'cold').length;
  const total = streams.length + nHotU + nColdU;
  const overall = Math.max(0, total - 1);
  if (streams.length === 0) return { overall, mer: overall, regions: [], hotUtilitiesUsed: nHotU, coldUtilitiesUsed: nColdU };

  const top = pt.boundaries[0];
  const bot = pt.boundaries[pt.boundaries.length - 1];
  const cuts = [top, ...pt.pinches, bot];
  const regions: UnitsTarget['regions'] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const tTop = cuts[i];
    const tBot = cuts[i + 1];
    let count = 0;
    for (const s of streams) {
      const present = s.pieces.some((p) => {
        if (!p.iso) return Math.min(p.sHi, tTop) - Math.max(p.sLo, tBot) > EPS;
        // Phase change exactly at a pinch: hot heat at T can only go below T, cold heat only above.
        const t = p.sLo;
        if (t < tTop - EPS && t > tBot + EPS) return true;
        if (Math.abs(t - tTop) < EPS) return s.kind === 'hot';
        if (Math.abs(t - tBot) < EPS) return s.kind === 'cold';
        return false;
      });
      if (present) count++;
    }
    if (i === 0) count += nHotU;
    if (i === cuts.length - 2) count += nColdU;
    regions.push({ tTop, tBot, count });
  }
  const mer = regions.reduce((s, r) => s + Math.max(0, r.count - 1), 0);
  return { overall, mer, regions, hotUtilitiesUsed: nHotU, coldUtilitiesUsed: nColdU };
}
