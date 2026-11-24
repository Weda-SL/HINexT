/**
 * Heat exchanger network analysis (Stage 1B).
 *
 * Inputs: the units (exchangers, heaters, coolers) with their loads and order
 * positions. Everything here is recalculated: stream temperatures between
 * units, ΔT at each end, area, feasibility warnings and the comparison with
 * the targets. Pure functions, no UI.
 */
import type { Economics, NetUnit, Project, StreamSplit } from './types';
import type { Analysis } from './analyse';
import type { ResolvedStream, ResolvedUtility } from './streams';
import { EPS } from './streams';
import { annualisationFactor, unitCapital } from './costs';

export const PINCH_X = 0.5;

// ---------------------------------------------------------------------------
// Stream enthalpy profiles (actual temperatures, measured from the supply end)
// ---------------------------------------------------------------------------

export interface Profile {
  /** Breakpoints (Q from supply, T), Q non-decreasing */
  pts: { q: number; t: number }[];
  duty: number;
  /** Temperature after Q kW has been exchanged from the supply end */
  tempAt(q: number): number;
  /** Least Q from the supply end at which the stream reaches T (clamped to [0, duty]) */
  heatTo(t: number): number;
  /** Local CP (kW/K) just after Q from the supply end; Infinity on a phase change */
  cpAt(q: number): number;
}

export function profileOf(s: ResolvedStream): Profile {
  const hot = s.kind === 'hot';
  const pieces = [...s.pieces].sort((a, b) =>
    hot ? b.hi - a.hi || b.lo - a.lo : a.lo - b.lo || a.hi - b.hi,
  );
  const pts = [{ q: 0, t: s.ts }];
  let q = 0;
  for (const p of pieces) {
    q += p.q;
    pts.push({ q, t: hot ? p.lo : p.hi });
  }
  const duty = q;
  const tempAt = (x: number) => {
    if (x <= 0) return pts[0].t;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (x <= b.q + 1e-12) return b.q - a.q < 1e-12 ? b.t : a.t + ((b.t - a.t) * (x - a.q)) / (b.q - a.q);
    }
    // beyond the duty: extrapolate with the last segment's CP
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    const slope = b.q - a.q > 1e-12 ? (b.t - a.t) / (b.q - a.q) : hot ? -1 / Math.max(s.cp || 1, 1e-9) : 1 / Math.max(s.cp || 1, 1e-9);
    return b.t + slope * (x - b.q);
  };
  const heatTo = (t: number) => {
    // hot: temperature falls with Q; cold: rises
    const past = (temp: number) => (hot ? temp <= t + EPS : temp >= t - EPS);
    if (past(pts[0].t)) return 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (past(b.t)) {
        if (Math.abs(b.t - a.t) < 1e-12) return a.q;
        return a.q + ((b.q - a.q) * (t - a.t)) / (b.t - a.t);
      }
    }
    return duty;
  };
  const cpAt = (x: number) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (x < b.q - 1e-9 || i === pts.length - 1) {
        const dT = Math.abs(b.t - a.t);
        return dT < 1e-12 ? Infinity : (b.q - a.q) / dT;
      }
    }
    return s.cp;
  };
  return { pts, duty, tempAt, heatTo, cpAt };
}

// ---------------------------------------------------------------------------
// Network results
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning';

export interface NetIssue {
  level: Severity;
  unit?: string;
  stream?: string;
  message: string;
}

export interface UnitResult {
  id: string;
  kind: NetUnit['kind'];
  load: number;
  hotIn: number;
  hotOut: number;
  coldIn: number;
  coldOut: number;
  /** Hot-end ΔT (hot in − cold out) and cold-end ΔT (hot out − cold in), K */
  dtHot: number;
  dtCold: number;
  lmtd: number;
  /** kW/(m²·K), NaN when a film coefficient is missing */
  u: number;
  area: number;
  capital: number;
  /** above / below / across the pinch (by position) */
  side: 'above' | 'below';
  /** Heat transferred across the pinch by this unit, kW */
  crossPinch: number;
  valid: boolean;
}

export interface StreamResult {
  id: string;
  /** Heat already exchanged by units on this stream, kW */
  assigned: number;
  /** Duty still to be met (negative = over-satisfied), kW */
  remaining: number;
  /** Heat still unmatched above / below the pinch, kW */
  remainingAbove: number;
  remainingBelow: number;
  /** Temperatures at each point along the flow, in order: [supply, after unit 1, …] */
  temps: { unit: string | null; t: number }[];
  /** Q from supply at which the stream reaches its pinch temperature */
  pinchQ: number;
  /** Branches of a split on each side of the pinch */
  branches?: Partial<Record<Region, BranchResult[]>>;
}

export type Region = 'above' | 'below';

export interface BranchResult {
  fraction: number;
  /** CP of the branch at the pinch end, kW/K */
  cp: number;
  /** Branch share of the stream's duty on that side, kW */
  duty: number;
  remaining: number;
}

export interface NetworkResult {
  units: UnitResult[];
  streams: Map<string, StreamResult>;
  issues: NetIssue[];
  qh: number;
  qc: number;
  unitCount: number;
  area: number;
  capital: number;
  capitalAnnual: number;
  operating: number;
  total: number;
  /** All stream duties met with no errors */
  complete: boolean;
  /** Whether the problem has a pinch (without one, everything counts as 'above') */
  hasPinch: boolean;
  /** Stream-count rule at the pinch */
  pinchCounts?: { aboveHot: number; aboveCold: number; belowHot: number; belowCold: number };
}

const finite = (x: number) => Number.isFinite(x);

export function lmtdOf(d1: number, d2: number): number {
  if (d1 <= 0 || d2 <= 0) return NaN;
  if (Math.abs(d1 - d2) < 1e-9) return (d1 + d2) / 2;
  return (d1 - d2) / Math.log(d1 / d2);
}

/** Pinch temperature of a stream: shifted pinch ± its ΔT contribution. */
function streamPinchT(s: ResolvedStream, pinch: number | undefined): number | undefined {
  if (pinch === undefined) return undefined;
  return s.kind === 'hot' ? pinch + s.dtc : pinch - s.dtc;
}

function utilityTemps(u: ResolvedUtility | undefined): { tin: number; tout: number } {
  if (!u) return { tin: NaN, tout: NaN };
  return { tin: u.ts, tout: u.tt };
}

/**
 * Units on a stream in flow order: hot streams left → right (x ascending),
 * cold streams right → left (x descending).
 */
function flowOrder(units: NetUnit[], s: ResolvedStream): NetUnit[] {
  const mine = units.filter((u) => (s.kind === 'hot' ? u.hot === s.id : u.cold === s.id));
  return mine.sort((a, b) => (s.kind === 'hot' ? a.x - b.x : b.x - a.x) || a.id.localeCompare(b.id));
}

export type TempMode = 'pinch' | 'series';

/** Side of the pinch a position belongs to (without a pinch everything is 'above'). */
export function regionOf(x: number, hasPinch: boolean): Region {
  return !hasPinch || x < PINCH_X ? 'above' : 'below';
}

/** Valid splits of a project, keyed `${stream}|${side}`, fractions normalised (2+ branches only). */
export function splitMap(project: Project): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const sp of project.network?.splits ?? []) {
    const f = sp.fractions.filter((x) => Number.isFinite(x) && x > 0);
    const sum = f.reduce((a, b) => a + b, 0);
    if (f.length < 2 || !(sum > 0)) continue;
    out.set(`${sp.stream}|${sp.side}`, f.map((x) => x / sum));
  }
  return out;
}

export function splitOf(project: Project, stream: string, side: Region): StreamSplit | undefined {
  return project.network?.splits?.find((sp) => sp.stream === stream && sp.side === side);
}

/** Branch index of a unit on a split stream (clamped; 0 when unset). */
export function branchIndex(u: NetUnit, kind: 'hot' | 'cold', n: number): number {
  const b = kind === 'hot' ? u.hotBranch : u.coldBranch;
  return Math.min(n - 1, Math.max(0, Math.round(b ?? 0)));
}

/**
 * mode 'pinch' (pinch design method, used while designing): units above and
 * below the pinch are designed separately, so on each side a stream starts at
 * its pinch temperature (hot streams below the pinch, cold streams above it).
 * mode 'series' (whole network, used for evolution): temperatures follow the
 * units one after another along each stream. For a complete MER design the two
 * give the same temperatures.
 */
export function analyseNetwork(project: Project, analysis: Analysis, mode: TempMode = 'series'): NetworkResult {
  const units = project.network?.units ?? [];
  const streams = new Map(analysis.streams.map((s) => [s.id, s]));
  const utils = new Map(analysis.utilities.map((u) => [u.id, u]));
  const pinch = analysis.pt.pinches[0];
  const dtMin = analysis.dtMin;
  const issues: NetIssue[] = [];
  const profiles = new Map(analysis.streams.map((s) => [s.id, profileOf(s)]));
  const tags = unitTags(units);

  // Walk every stream in flow order to get inlet/outlet temperatures of each unit side.
  const side = new Map<string, SideTemps>();
  for (const u of units) side.set(u.id, { hotIn: NaN, hotOut: NaN, coldIn: NaN, coldOut: NaN, hotQ0: 0, coldQ0: 0, hotF: 1, coldF: 1 });
  const splits = splitMap(project);
  const hasPinch = pinch !== undefined;
  const streamResults = new Map<string, StreamResult>();
  for (const s of analysis.streams) {
    const prof = profiles.get(s.id)!;
    const order = flowOrder(units, s);
    const pTs = streamPinchT(s, pinch);
    const pinchStartQ = pTs === undefined ? 0 : prof.heatTo(pTs);
    let q = 0;
    let crossed = false;
    const temps: StreamResult['temps'] = [{ unit: null, t: prof.tempAt(0) }];
    const kindKey = s.kind;
    for (let i = 0; i < order.length; ) {
      const u = order[i];
      // pinch design: the second side of the pinch starts at the pinch temperature
      const secondSide = s.kind === 'hot' ? u.x >= PINCH_X : u.x < PINCH_X;
      if (mode === 'pinch' && pTs !== undefined && secondSide && !crossed) {
        q = pinchStartQ;
        crossed = true;
      }
      const reg = regionOf(u.x, hasPinch);
      const fr = splits.get(`${s.id}|${reg}`);
      if (!fr) {
        const r = side.get(u.id)!;
        const tin = prof.tempAt(q);
        const q0 = q;
        q += Math.max(0, u.load);
        const tout = prof.tempAt(q);
        if (kindKey === 'hot') Object.assign(r, { hotIn: tin, hotOut: tout, hotQ0: q0, hotF: 1 });
        else Object.assign(r, { coldIn: tin, coldOut: tout, coldQ0: q0, coldF: 1 });
        temps.push({ unit: u.id, t: tout });
        i++;
        continue;
      }
      // split region: the branches all start at the stream's temperature here and mix at the end.
      // A branch with flow fraction f that has taken qb kW is at the stream temperature for qEnter + qb / f.
      const qEnter = q;
      const bq = fr.map(() => 0);
      let j = i;
      while (j < order.length && regionOf(order[j].x, hasPinch) === reg) {
        const v = order[j];
        const r = side.get(v.id)!;
        const b = branchIndex(v, kindKey, fr.length);
        const f = fr[b];
        const q0 = qEnter + bq[b] / f;
        const tin = prof.tempAt(q0);
        bq[b] += Math.max(0, v.load);
        const tout = prof.tempAt(qEnter + bq[b] / f);
        if (kindKey === 'hot') Object.assign(r, { hotIn: tin, hotOut: tout, hotQ0: q0, hotF: f });
        else Object.assign(r, { coldIn: tin, coldOut: tout, coldQ0: q0, coldF: f });
        temps.push({ unit: v.id, t: tout });
        j++;
      }
      q = qEnter + bq.reduce((a, b) => a + b, 0);
      i = j;
    }
    const pT = streamPinchT(s, pinch);
    const pinchQ = pT === undefined ? (s.kind === 'hot' ? prof.duty : 0) : prof.heatTo(pT);
    // heat above the pinch: hot streams from supply down to pinch; cold streams from pinch up to target
    const dutyAbove = s.kind === 'hot' ? pinchQ : prof.duty - pinchQ;
    const dutyBelow = prof.duty - dutyAbove;
    let assignedAbove = 0;
    let assignedBelow = 0;
    for (const u of order) (u.x < PINCH_X ? (assignedAbove += u.load) : (assignedBelow += u.load));
    const assigned = assignedAbove + assignedBelow;
    const branches: StreamResult['branches'] = {};
    for (const reg of ['above', 'below'] as const) {
      const fr = splits.get(`${s.id}|${reg}`);
      if (!fr) continue;
      const dutySide = reg === 'above' ? dutyAbove : dutyBelow;
      // CP at the pinch end of this side
      const qPinchEnd = s.kind === 'hot' ? (reg === 'above' ? Math.max(0, pinchQ - 1e-9) : pinchQ) : reg === 'above' ? pinchQ : Math.max(0, pinchQ - 1e-9);
      const cpEnd = prof.cpAt(qPinchEnd);
      const list = fr.map((f) => ({ fraction: f, cp: cpEnd * f, duty: f * dutySide, remaining: f * dutySide }));
      for (const u of order) {
        if (regionOf(u.x, hasPinch) !== reg) continue;
        list[branchIndex(u, s.kind, fr.length)].remaining -= u.load;
      }
      list.forEach((b, k) => {
        if (b.remaining < -1e-6 * Math.max(1, b.duty)) {
          issues.push({ level: 'error', stream: s.id, message: `${s.name}, branch ${k + 1} ${reg} the pinch: units take ${fmt(b.duty - b.remaining)} kW but the branch only has ${fmt(b.duty)} kW.` });
        }
      });
      branches[reg] = list;
    }
    streamResults.set(s.id, {
      id: s.id,
      assigned,
      remaining: prof.duty - assigned,
      remainingAbove: dutyAbove - assignedAbove,
      remainingBelow: dutyBelow - assignedBelow,
      temps,
      pinchQ,
      branches: Object.keys(branches).length ? branches : undefined,
    });
    if (assigned > prof.duty + 1e-6 * Math.max(1, prof.duty)) {
      issues.push({ level: 'error', stream: s.id, message: `${s.name}: units exchange ${fmt(assigned)} kW but the stream only has ${fmt(prof.duty)} kW.` });
    }
  }

  const results: UnitResult[] = [];
  for (const u of units) {
    const r = side.get(u.id)!;
    const hs = u.hot ? streams.get(u.hot) : undefined;
    const cs = u.cold ? streams.get(u.cold) : undefined;
    const ut = u.utility ? utils.get(u.utility) : undefined;
    let { hotIn, hotOut, coldIn, coldOut } = r;
    let hH: number | undefined;
    let hC: number | undefined;
    let valid = true;
    const name = unitName(u, streams, utils, tags);
    if (u.kind === 'exchanger') {
      if (!hs || !cs || hs.kind !== 'hot' || cs.kind !== 'cold') valid = false;
      hH = hs ? pieceH(hs, profiles.get(hs.id)!, r.hotQ0, u.load / r.hotF) : undefined;
      hC = cs ? pieceH(cs, profiles.get(cs.id)!, r.coldQ0, u.load / r.coldF) : undefined;
    } else if (u.kind === 'heater') {
      if (!cs || !ut || ut.kind !== 'hot') valid = false;
      const t = utilityTemps(ut);
      hotIn = t.tin;
      hotOut = t.tout;
      hH = ut?.h;
      hC = cs ? pieceH(cs, profiles.get(cs.id)!, r.coldQ0, u.load / r.coldF) : undefined;
    } else {
      if (!hs || !ut || ut.kind !== 'cold') valid = false;
      const t = utilityTemps(ut);
      coldIn = t.tin;
      coldOut = t.tout;
      hH = hs ? pieceH(hs, profiles.get(hs.id)!, r.hotQ0, u.load / r.hotF) : undefined;
      hC = ut?.h;
    }
    if (!valid) {
      issues.push({ level: 'error', unit: u.id, message: `${name}: refers to a stream or utility that no longer exists or has the wrong type.` });
    }
    if (!(u.load > 0)) issues.push({ level: 'warning', unit: u.id, message: `${name}: load is zero.` });
    const dtHot = hotIn - coldOut;
    const dtCold = hotOut - coldIn;
    const lmtd = lmtdOf(dtHot, dtCold);
    const uVal = hH && hC ? 1 / (1 / hH + 1 / hC) : NaN;
    const area = finite(lmtd) && finite(uVal) && u.load > 0 ? u.load / (uVal * lmtd) : u.load > 0 ? NaN : 0;
    if (valid && u.load > 0) {
      const minDt = Math.min(dtHot, dtCold);
      if (minDt <= 1e-9) {
        issues.push({ level: 'error', unit: u.id, message: `${name}: temperature cross (ΔT ${fmt(minDt)} K). Reduce the load or move the unit.` });
      } else if (minDt < dtMin - 1e-6) {
        issues.push({ level: 'warning', unit: u.id, message: `${name}: ΔT ${fmt(minDt)} K is below ΔTmin (${fmt(dtMin)} K).` });
      }
    }
    const crossPinch = valid ? crossPinchHeat(u, r, hs, cs, profiles, pinch) : 0;
    if (crossPinch > 1e-6) {
      const what = u.kind === 'heater' ? 'heats below the pinch' : u.kind === 'cooler' ? 'cools above the pinch' : 'transfers heat across the pinch';
      issues.push({ level: 'warning', unit: u.id, message: `${name}: ${what} (${fmt(crossPinch)} kW). Each kW adds 1 kW to both hot and cold utility.` });
    }
    results.push({
      id: u.id,
      kind: u.kind,
      load: u.load,
      hotIn,
      hotOut,
      coldIn,
      coldOut,
      dtHot,
      dtCold,
      lmtd,
      u: uVal,
      area,
      capital: finite(area) ? unitCapital(project.economics.capital, u.kind, area) : NaN,
      side: u.x < PINCH_X ? 'above' : 'below',
      crossPinch,
      valid,
    });
  }

  // CP feasibility rule for exchangers that start at the pinch
  if (pinch !== undefined) {
    for (const u of units) {
      if (u.kind !== 'exchanger') continue;
      const hs = streams.get(u.hot!);
      const cs = streams.get(u.cold!);
      if (!hs || !cs) continue;
      const r = side.get(u.id)!;
      const hp = streamPinchT(hs, pinch)!;
      const cp = streamPinchT(cs, pinch)!;
      const ph = profiles.get(hs.id)!;
      const pc = profiles.get(cs.id)!;
      if (u.x < PINCH_X && Math.abs(r.hotOut - hp) < 1e-6 && Math.abs(r.coldIn - cp) < 1e-6) {
        const cpH = ph.cpAt(r.hotQ0 + u.load / r.hotF - 1e-9) * r.hotF;
        const cpC = pc.cpAt(r.coldQ0) * r.coldF;
        if (cpH > cpC + 1e-9) {
          issues.push({ level: 'warning', unit: u.id, message: `${unitName(u, streams, utils, tags)}: above the pinch CP hot (${fmt(cpH)}) should be ≤ CP cold (${fmt(cpC)}).` });
        }
      }
      if (u.x >= PINCH_X && Math.abs(r.hotIn - hp) < 1e-6 && Math.abs(r.coldOut - cp) < 1e-6) {
        const cpH = ph.cpAt(r.hotQ0) * r.hotF;
        const cpC = pc.cpAt(r.coldQ0 + u.load / r.coldF - 1e-9) * r.coldF;
        if (cpH + 1e-9 < cpC) {
          issues.push({ level: 'warning', unit: u.id, message: `${unitName(u, streams, utils, tags)}: below the pinch CP hot (${fmt(cpH)}) should be ≥ CP cold (${fmt(cpC)}).` });
        }
      }
    }
  }

  // Unmet duties
  for (const s of analysis.streams) {
    const sr = streamResults.get(s.id)!;
    if (sr.remaining > 1e-6 * Math.max(1, Math.abs(s.duty)) && units.length > 0) {
      issues.push({
        level: 'warning',
        stream: s.id,
        message: `${s.name}: ${fmt(sr.remaining)} kW still to ${s.kind === 'hot' ? 'cool' : 'heat'} (needs a ${s.kind === 'hot' ? 'cooler' : 'heater'} or another match).`,
      });
    }
  }

  let pinchCounts: NetworkResult['pinchCounts'];
  if (pinch !== undefined) {
    const above = (s: ResolvedStream) => {
      const sr = streamResults.get(s.id)!;
      return s.kind === 'hot' ? sr.pinchQ > 1e-9 : profiles.get(s.id)!.duty - sr.pinchQ > 1e-9;
    };
    const below = (s: ResolvedStream) => {
      const sr = streamResults.get(s.id)!;
      return s.kind === 'hot' ? profiles.get(s.id)!.duty - sr.pinchQ > 1e-9 : sr.pinchQ > 1e-9;
    };
    const hots = analysis.streams.filter((s) => s.kind === 'hot');
    const colds = analysis.streams.filter((s) => s.kind === 'cold');
    // a split stream counts once per branch on that side
    const n = (list: ResolvedStream[], on: (s: ResolvedStream) => boolean, reg: Region) =>
      list.filter(on).reduce((t, s) => t + (splits.get(`${s.id}|${reg}`)?.length ?? 1), 0);
    pinchCounts = {
      aboveHot: n(hots, above, 'above'),
      aboveCold: n(colds, above, 'above'),
      belowHot: n(hots, below, 'below'),
      belowCold: n(colds, below, 'below'),
    };
  }

  const qh = units.filter((u) => u.kind === 'heater').reduce((s, u) => s + u.load, 0);
  const qc = units.filter((u) => u.kind === 'cooler').reduce((s, u) => s + u.load, 0);
  const operating = units
    .filter((u) => u.kind !== 'exchanger')
    .reduce((s, u) => s + u.load * (utils.get(u.utility ?? '')?.cost ?? 0), 0);
  const area = results.reduce((s, r) => s + (r.load > 0 ? r.area : 0), 0);
  const capital = results.reduce((s, r) => s + (r.load > 0 ? r.capital : 0), 0);
  const capitalAnnual = capital * annualisationFactor(project.economics.interestRate, project.economics.plantLife);
  const complete =
    units.length > 0 &&
    !issues.some((i) => i.level === 'error') &&
    [...streamResults.values()].every((sr) => Math.abs(sr.remaining) < 1e-6 * Math.max(1, sr.assigned));
  return {
    units: results,
    streams: streamResults,
    issues,
    qh,
    qc,
    unitCount: units.filter((u) => u.load > 0).length,
    area,
    capital,
    capitalAnnual,
    operating,
    total: operating + capitalAnnual,
    complete,
    hasPinch,
    pinchCounts,
  };
}

/** Film coefficient of the stream over the part of its profile this unit covers (first piece if several). */
function pieceH(s: ResolvedStream, prof: Profile, q0: number, load: number): number | undefined {
  if (s.pieces.length === 1) return s.pieces[0].h;
  const tMid = prof.tempAt(q0 + load / 2);
  const p = s.pieces.find((pc) => tMid >= pc.lo - EPS && tMid <= pc.hi + EPS);
  return p?.h ?? s.h;
}

interface SideTemps {
  hotIn: number;
  hotOut: number;
  coldIn: number;
  coldOut: number;
  /** Stream-equivalent Q from supply where the unit starts (for a branch: qEnter + branch Q / fraction) */
  hotQ0: number;
  coldQ0: number;
  /** Flow fraction of the branch the unit sits on (1 when not split) */
  hotF: number;
  coldF: number;
}

/** Heat a unit moves across the pinch, kW. */
function crossPinchHeat(
  u: NetUnit,
  r: SideTemps,
  hs: ResolvedStream | undefined,
  cs: ResolvedStream | undefined,
  profiles: Map<string, Profile>,
  pinch: number | undefined,
): number {
  if (pinch === undefined) return 0;
  // hot heat released above its pinch temperature by this unit
  const hotAbove = () => {
    if (!hs) return 0;
    const pq = profiles.get(hs.id)!.heatTo(streamPinchT(hs, pinch)!);
    return Math.max(0, Math.min(r.hotQ0 + u.load / r.hotF, pq) - r.hotQ0) * r.hotF;
  };
  const hotBelow = () => (hs ? u.load - hotAbove() : 0);
  // cold heat absorbed below its pinch temperature
  const coldBelow = () => {
    if (!cs) return 0;
    const pq = profiles.get(cs.id)!.heatTo(streamPinchT(cs, pinch)!);
    return Math.max(0, Math.min(r.coldQ0 + u.load / r.coldF, pq) - r.coldQ0) * r.coldF;
  };
  if (u.kind === 'heater') return coldBelow();
  if (u.kind === 'cooler') return u.load - hotBelow();
  return Math.min(hotAbove(), coldBelow());
}

/**
 * Short tags for units, numbered in the order they were added:
 * exchangers E1, E2…, heaters H1…, coolers C1….
 */
export function unitTags(units: NetUnit[]): Map<string, string> {
  const count = { exchanger: 0, heater: 0, cooler: 0 };
  const prefix = { exchanger: 'E', heater: 'H', cooler: 'C' };
  return new Map(units.map((u) => [u.id, `${prefix[u.kind]}${++count[u.kind]}`]));
}

export function unitName(
  u: NetUnit,
  streams: Map<string, ResolvedStream>,
  utils: Map<string, ResolvedUtility>,
  tags?: Map<string, string>,
): string {
  const n = (id?: string) => (id ? (streams.get(id)?.name ?? utils.get(id)?.name ?? '?') : '?');
  const tag = tags?.get(u.id);
  const body = u.kind === 'exchanger' ? `${n(u.hot)}–${n(u.cold)}` : u.kind === 'heater' ? `heater on ${n(u.cold)}` : `cooler on ${n(u.hot)}`;
  if (tag) return `${tag} (${body})`;
  return u.kind === 'exchanger' ? body : body[0].toUpperCase() + body.slice(1);
}

/**
 * Tick-off heuristic: the largest load a new exchanger between two streams can
 * take on its side of the pinch — the smaller of the two streams' unmatched heat there.
 */
export function tickOffLoad(net: NetworkResult, hot: string, cold: string, x: number, hotBranch?: number, coldBranch?: number): number {
  return Math.max(0, Math.min(endRemaining(net, hot, x, hotBranch), endRemaining(net, cold, x, coldBranch)));
}

/** Unmatched heat of a stream (or of one branch of it, when split there) on the side of the pinch at x. */
export function endRemaining(net: NetworkResult, stream: string, x: number, branch?: number): number {
  const sr = net.streams.get(stream);
  if (!sr) return 0;
  const reg = regionOf(x, net.hasPinch);
  const br = sr.branches?.[reg];
  if (br) return br[Math.min(br.length - 1, Math.max(0, branch ?? 0))].remaining;
  return reg === 'above' ? sr.remainingAbove : sr.remainingBelow;
}

/** Annualised cost helper for evolution tables. */
export function annualFactor(econ: Economics): number {
  return annualisationFactor(econ.interestRate, econ.plantLife);
}

function fmt(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toLocaleString('en', { maximumFractionDigits: 2 });
}
