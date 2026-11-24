/**
 * Network evolution (Stage 1C): loops, utility paths, load shifting and
 * solving for the shift that restores ΔTmin. Pure functions, no UI.
 */
import type { NetUnit, Project } from './types';
import type { Analysis } from './analyse';
import { analyseNetwork } from './network';

export interface Shift {
  /** unit id → +1 or −1: the unit's load changes by sign · x */
  signs: Map<string, 1 | -1>;
  /** Node sequence (stream / utility ids) visited, for display */
  nodes: string[];
  /** Unit ids in order */
  edges: string[];
}

export interface Loop extends Shift {
  kind: 'loop';
}
export interface UtilityPath extends Shift {
  kind: 'path';
}

const MAX_LENGTH = 14;
const MAX_FOUND = 300;

function endpoints(u: NetUnit): [string, string] {
  if (u.kind === 'exchanger') return [u.hot!, u.cold!];
  if (u.kind === 'heater') return [u.utility!, u.cold!];
  return [u.hot!, u.utility!];
}

function activeUnits(units: NetUnit[]): NetUnit[] {
  return units.filter((u) => u.load > 1e-9);
}

/** Euler's network theorem: independent loops L = U − N + S. */
export function loopCount(units: NetUnit[]): { loops: number; units: number; nodes: number; components: number } {
  const act = activeUnits(units);
  const nodes = new Set<string>();
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    while (parent.get(a) !== a) {
      parent.set(a, parent.get(parent.get(a)!)!);
      a = parent.get(a)!;
    }
    return a;
  };
  for (const u of act) {
    const [a, b] = endpoints(u);
    for (const n of [a, b]) {
      if (!nodes.has(n)) {
        nodes.add(n);
        parent.set(n, n);
      }
    }
    parent.set(find(a), find(b));
  }
  const comps = new Set([...nodes].map(find)).size;
  return { loops: act.length - nodes.size + comps, units: act.length, nodes: nodes.size, components: comps };
}

function adjacency(units: NetUnit[]) {
  const adj = new Map<string, { edge: string; to: string }[]>();
  const add = (a: string, e: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ edge: e, to: b });
  };
  for (const u of activeUnits(units)) {
    const [a, b] = endpoints(u);
    add(a, u.id, b);
    add(b, u.id, a);
  }
  return adj;
}

function alternate(edges: string[]): Map<string, 1 | -1> {
  const m = new Map<string, 1 | -1>();
  edges.forEach((e, i) => m.set(e, i % 2 === 0 ? 1 : -1));
  return m;
}

/** Every simple loop in the network (cycles of units), shortest first. */
export function findLoops(units: NetUnit[]): Loop[] {
  const adj = adjacency(units);
  const order = [...adj.keys()].sort();
  const rank = new Map(order.map((n, i) => [n, i]));
  const seen = new Set<string>();
  const out: Loop[] = [];
  for (const start of order) {
    const r0 = rank.get(start)!;
    const nodes = [start];
    const edges: string[] = [];
    const used = new Set<string>();
    const dfs = (n: string) => {
      if (out.length >= MAX_FOUND || edges.length >= MAX_LENGTH) return;
      for (const { edge, to } of adj.get(n) ?? []) {
        if (used.has(edge)) continue;
        if (to === start && edges.length >= 1) {
          const cyc = [...edges, edge];
          const key = [...cyc].sort().join('|');
          if (!seen.has(key) && cyc.length % 2 === 0) {
            seen.add(key);
            out.push({ kind: 'loop', edges: cyc, nodes: [...nodes, start], signs: alternate(cyc) });
          }
          continue;
        }
        if (rank.get(to)! <= r0 || nodes.includes(to)) continue;
        used.add(edge);
        nodes.push(to);
        edges.push(edge);
        dfs(to);
        edges.pop();
        nodes.pop();
        used.delete(edge);
      }
    };
    dfs(start);
  }
  return out.sort((a, b) => a.edges.length - b.edges.length);
}

/** Every simple path from a hot utility to a cold utility through the network, shortest first. */
export function findPaths(units: NetUnit[], project: Project): UtilityPath[] {
  const adj = adjacency(units);
  const hotU = new Set(project.utilities.filter((u) => u.kind === 'hot').map((u) => u.id));
  const coldU = new Set(project.utilities.filter((u) => u.kind === 'cold').map((u) => u.id));
  const out: UtilityPath[] = [];
  for (const start of adj.keys()) {
    if (!hotU.has(start)) continue;
    const nodes = [start];
    const edges: string[] = [];
    const dfs = (n: string) => {
      if (out.length >= MAX_FOUND || edges.length >= MAX_LENGTH) return;
      for (const { edge, to } of adj.get(n) ?? []) {
        if (nodes.includes(to)) continue;
        if (hotU.has(to)) continue;
        nodes.push(to);
        edges.push(edge);
        if (coldU.has(to)) {
          out.push({ kind: 'path', edges: [...edges], nodes: [...nodes], signs: alternate(edges) });
        } else {
          dfs(to);
        }
        edges.pop();
        nodes.pop();
      }
    };
    dfs(start);
  }
  return out.sort((a, b) => a.edges.length - b.edges.length);
}

/** Apply a load shift of x; units whose load reaches zero are removed. */
export function applyShift(units: NetUnit[], signs: Map<string, 1 | -1>, x: number): NetUnit[] {
  return units
    .map((u) => (signs.has(u.id) ? { ...u, load: u.load + signs.get(u.id)! * x } : u))
    .filter((u) => !signs.has(u.id) || u.load > 1e-7 * Math.max(1, Math.abs(x)))
    .map((u) => (signs.has(u.id) ? { ...u, load: +u.load.toFixed(9) } : u));
}

/** Largest x for which no load goes negative with the given signs. */
export function maxShift(units: NetUnit[], signs: Map<string, 1 | -1>): number {
  let m = Infinity;
  for (const u of units) if (signs.get(u.id) === -1) m = Math.min(m, u.load);
  return m;
}

/**
 * Breaking a loop: the shift that removes its smallest unit. Signs are flipped
 * if needed so that the smallest unit is the one being reduced.
 */
export function breakLoop(units: NetUnit[], loop: Shift): { signs: Map<string, 1 | -1>; x: number; removes: string } {
  const loads = new Map(units.map((u) => [u.id, u.load]));
  let best = loop.edges[0];
  for (const e of loop.edges) if ((loads.get(e) ?? Infinity) < (loads.get(best) ?? Infinity)) best = e;
  const signs = new Map(loop.signs);
  if (signs.get(best) === 1) for (const [k, v] of signs) signs.set(k, (v * -1) as 1 | -1);
  return { signs, x: loads.get(best) ?? 0, removes: best };
}

/** Smallest ΔT of one unit (or of every unit) in a network. */
function minDt(project: Project, analysis: Analysis, units: NetUnit[], unitId?: string): number {
  const net = analyseNetwork({ ...project, network: { units } }, analysis);
  let m = Infinity;
  for (const r of net.units) {
    if (r.load <= 0) continue;
    if (unitId && r.id !== unitId) continue;
    m = Math.min(m, r.dtHot, r.dtCold);
  }
  return m;
}

/**
 * Relaxing along a path: the smallest x ≥ 0 that brings the chosen unit (or,
 * if none is given, every unit) back to ΔT ≥ ΔTmin. Temperatures are linear in
 * x for constant-CP streams; bisection also covers non-linear profiles.
 * Returns null when no x within the path's range achieves it.
 */
export function solveShift(
  project: Project,
  analysis: Analysis,
  units: NetUnit[],
  signs: Map<string, 1 | -1>,
  unitId?: string,
): number | null {
  const target = analysis.dtMin;
  const f = (x: number) => minDt(project, analysis, applyShift(units, signs, x), unitId) - target;
  const tol = 1e-7;
  if (f(0) >= -tol) return 0;
  let hi = maxShift(units, signs);
  if (!Number.isFinite(hi)) {
    // no unit is reduced (all +x): grow until feasible
    hi = 1;
    while (f(hi) < -tol && hi < 1e9) hi *= 2;
  }
  // the unit being solved for may disappear exactly at hi; stay just inside
  const top = hi * (1 - 1e-9);
  if (f(top) < -tol) return null;
  let lo = 0;
  let up = top;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + up) / 2;
    if (f(mid) >= -tol) up = mid;
    else lo = mid;
  }
  return up;
}
