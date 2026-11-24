import { cascadeMin, streamItems, type HeatItem, type ProblemTable } from './cascade';
import type { Issue, ResolvedStream, ResolvedUtility } from './streams';

export interface UtilityTarget {
  id: string;
  /** True when the user's limit, not the process, set this duty */
  limited: boolean;
  name: string;
  kind: 'hot' | 'cold';
  /** Duty assigned by the targeting, kW */
  duty: number;
  /** $/yr */
  opCost: number;
}

export interface UtilityPlacement {
  targets: UtilityTarget[];
  /** Hot utility demand no defined utility could supply (too cold), kW */
  unmetHot: number;
  /** Cold utility demand no defined utility could absorb (too hot), kW */
  unmetCold: number;
  /** Items (process + placed utilities) — used for the GCC utility profiles */
  issues: Issue[];
}

function itemFor(u: ResolvedUtility, q: number): HeatItem {
  const sign = u.kind === 'hot' ? 1 : -1;
  if (u.isothermal) return { kind: 'point', t: u.sTs, q: sign * q };
  const top = Math.max(u.sTs, u.sTt);
  const bot = Math.min(u.sTs, u.sTt);
  return { kind: 'range', top, bot, cp: (sign * q) / (top - bot) };
}

function netHeat(items: HeatItem[]): number {
  let s = 0;
  for (const it of items) s += it.kind === 'point' ? it.q : it.cp * (it.top - it.bot);
  return s;
}

/** Hot utility still required from above everything, given the current items. */
function required(items: HeatItem[]): number {
  return Math.max(0, -cascadeMin(items));
}

/**
 * Place multiple utilities against the Grand Composite Curve.
 *
 * Hot utilities are used coldest-first (cheapest level first): each takes as much
 * duty as it can while lowering the remaining hot demand one-for-one. Cold
 * utilities are then used warmest-first: each absorbs as much as the cascade can
 * feed without any heat flow going negative. This reproduces the classic
 * "utility levels touching the GCC" construction and handles both isothermal
 * (steam) and non-isothermal (hot oil, cooling water) utilities.
 */
export function placeUtilities(
  streams: ResolvedStream[],
  pt: ProblemTable,
  utilities: ResolvedUtility[],
): UtilityPlacement {
  const tol = 1e-7 * Math.max(1, pt.qhMin, pt.qcMin);
  const items: HeatItem[] = streamItems(streams);
  const duties = new Map<string, number>();
  const issues: Issue[] = [];

  // --- Hot utilities, coldest first ---
  const hot = utilities.filter((u) => u.kind === 'hot').sort((a, b) => a.sTs - b.sTs || a.sTt - b.sTt);
  for (const u of hot) {
    const rCur = required(items);
    if (rCur < tol) {
      duties.set(u.id, 0);
      continue;
    }
    const ok = (q: number) => required([...items, itemFor(u, q)]) <= rCur - q + tol;
    let q: number;
    if (ok(rCur)) q = rCur;
    else {
      let lo = 0;
      let hi = rCur;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) lo = mid;
        else hi = mid;
      }
      q = lo;
    }
    q = Math.min(q, u.maxDuty);
    if (q < tol) q = 0;
    duties.set(u.id, q);
    if (q > 0) items.push(itemFor(u, q));
  }
  const unmetHot = required(items);
  if (unmetHot > tol) {
    issues.push({
      level: 'warning',
      message:
        hot.length === 0
          ? 'No hot utility is defined, so hot utility cost is not counted.'
          : `${fmt(unmetHot)} kW of hot utility is needed above the hottest defined utility. Add a hotter utility.`,
    });
    // keep the cascade feasible so cold utilities can be placed
    const top = Math.max(...items.flatMap((it) => (it.kind === 'range' ? [it.top] : [it.t])));
    items.push({ kind: 'point', t: top + 1, q: unmetHot });
  }

  // --- Cold utilities, warmest first ---
  const cold = utilities.filter((u) => u.kind === 'cold').sort((a, b) => b.sTt - a.sTt || b.sTs - a.sTs);
  for (const u of cold) {
    const remaining = netHeat(items);
    if (remaining < tol) {
      duties.set(u.id, 0);
      continue;
    }
    const ok = (q: number) => cascadeMin([...items, itemFor(u, q)]) >= -tol;
    let q: number;
    if (ok(remaining)) q = remaining;
    else {
      let lo = 0;
      let hi = remaining;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2;
        if (ok(mid)) lo = mid;
        else hi = mid;
      }
      q = lo;
    }
    q = Math.min(q, u.maxDuty);
    if (q < tol) q = 0;
    duties.set(u.id, q);
    if (q > 0) items.push(itemFor(u, q));
  }
  let unmetCold = netHeat(items);
  if (unmetCold < tol) unmetCold = 0;
  if (unmetCold > 0) {
    issues.push({
      level: 'warning',
      message:
        cold.length === 0
          ? 'No cold utility is defined, so cold utility cost is not counted.'
          : `${fmt(unmetCold)} kW of cold utility is needed below the coldest defined utility. Add a colder utility.`,
    });
  }

  const targets: UtilityTarget[] = utilities.map((u) => {
    const duty = duties.get(u.id) ?? 0;
    return { id: u.id, name: u.name, kind: u.kind, duty, opCost: duty * u.cost, limited: Number.isFinite(u.maxDuty) && duty >= u.maxDuty - 1e-9 };
  });
  return { targets, unmetHot: unmetHot > tol ? unmetHot : 0, unmetCold, issues };
}

function fmt(x: number): string {
  return x.toLocaleString('en', { maximumFractionDigits: 2 });
}
