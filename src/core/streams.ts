import type { Stream, Utility } from './types';

export const EPS = 1e-7;

export interface ResolvedStream {
  id: string;
  name: string;
  kind: 'hot' | 'cold';
  ts: number;
  tt: number;
  cp: number;
  duty: number;
  h?: number;
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
    let cp: number;
    let duty: number;
    if (s.spec === 'duty') {
      if (!finite(s.duty) || s.duty <= 0) {
        issues.push({ level: 'error', ref: s.id, message: `${label}: heat load must be a positive number.` });
        continue;
      }
      duty = s.duty;
      cp = duty / dT;
    } else {
      if (!finite(s.cp) || s.cp <= 0) {
        issues.push({ level: 'error', ref: s.id, message: `${label}: CP must be a positive number.` });
        continue;
      }
      cp = s.cp;
      duty = cp * dT;
    }
    const dtc = finite(s.dtCont) && s.dtCont >= 0 ? s.dtCont : dtMin / 2;
    resolved.push({
      id: s.id,
      name: label,
      kind,
      ts: s.tSupply,
      tt: s.tTarget,
      cp,
      duty,
      h: finite(s.h) && s.h > 0 ? s.h : undefined,
      dtc,
      sTs: shift(s.tSupply, kind, dtc),
      sTt: shift(s.tTarget, kind, dtc),
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
      h: finite(u.h) && u.h > 0 ? u.h : undefined,
      dtc,
      sTs: shift(u.tSupply, u.kind, dtc),
      sTt: shift(u.tTarget, u.kind, dtc),
    });
  }
  return { resolved, issues };
}
