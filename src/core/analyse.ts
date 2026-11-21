import type { Project } from './types';
import { resolveStreams, resolveUtilities, type Issue, type ResolvedStream, type ResolvedUtility } from './streams';
import { problemTable, type ProblemTable } from './cascade';
import { placeUtilities, type UtilityTarget } from './utilities';
import { composites, grandComposite, utilityProfiles, type CompositeSet, type Point, type UtilityProfile } from './composites';
import { areaTarget, type AreaTarget } from './area';
import { unitsTarget, type UnitsTarget } from './units';
import { annualisationFactor, capitalCost } from './costs';

export interface CostTarget {
  /** $/yr */
  operating: number;
  /** $ installed */
  capital: number;
  /** $/yr */
  capitalAnnual: number;
  /** $/yr */
  total: number;
  annualisationFactor: number;
  /** Why capital (and so total) could not be computed, if so */
  capitalNote?: string;
}

export interface Analysis {
  dtMin: number;
  streams: ResolvedStream[];
  utilities: ResolvedUtility[];
  issues: Issue[];
  pt: ProblemTable;
  utilityTargets: UtilityTarget[];
  unmetHot: number;
  unmetCold: number;
  composites: CompositeSet;
  shiftedComposites: CompositeSet;
  gcc: Point[];
  utilityProfiles: UtilityProfile[];
  area: AreaTarget;
  units: UnitsTarget;
  cost: CostTarget;
}

/** Run the full targeting analysis. Pure: project in, results out. */
export function analyse(project: Project, dtMinOverride?: number): Analysis {
  const dtMin = dtMinOverride ?? project.settings.dtMin;
  const rs = resolveStreams(project.streams, dtMin);
  const ru = resolveUtilities(project.utilities, dtMin);
  const streams = rs.resolved;
  const utilities = ru.resolved;
  const issues: Issue[] = [...rs.issues, ...ru.issues];

  const pt = problemTable(streams);
  const placement = placeUtilities(streams, pt, utilities);
  issues.push(...placement.issues);

  const area = areaTarget(streams, utilities, placement.targets);
  const units = unitsTarget(streams, pt, placement.targets);

  const operating = placement.targets.reduce((s, t) => s + t.opCost, 0);
  const f = annualisationFactor(project.economics.interestRate, project.economics.plantLife);
  let capital = NaN;
  let capitalAnnual = NaN;
  let capitalNote: string | undefined;
  if (area.missingH.length > 0) {
    capitalNote = 'Enter a film coefficient h for every stream and every utility in use to get area and capital targets.';
  } else if (placement.unmetHot > 0 || placement.unmetCold > 0) {
    capitalNote = 'Area and capital need every utility demand to be met by a defined utility.';
  } else if (area.infeasible) {
    capitalNote = 'The balanced composite curves touch or cross, so the area is unbounded. Check ΔT contributions and utility temperatures.';
  } else if (area.total !== null) {
    const heater = units.hotUtilitiesUsed;
    const cooler = units.coldUtilitiesUsed;
    const res = capitalCost(
      project.economics.capital,
      {
        area: { total: area.total, exchanger: area.exchanger, heater: area.heater, cooler: area.cooler },
        units: { total: units.mer, exchanger: Math.max(0, units.mer - heater - cooler), heater, cooler },
      },
      project.economics,
    );
    if (res.error) capitalNote = `Capital cost model: ${res.error}`;
    else {
      capital = res.capital;
      capitalAnnual = res.annual;
    }
  }
  if (area.missingH.length > 0 && streams.length > 0) {
    issues.push({ level: 'warning', message: capitalNote! });
  }

  return {
    dtMin,
    streams,
    utilities,
    issues,
    pt,
    utilityTargets: placement.targets,
    unmetHot: placement.unmetHot,
    unmetCold: placement.unmetCold,
    composites: composites(streams, pt, false),
    shiftedComposites: composites(streams, pt, true),
    gcc: grandComposite(pt),
    utilityProfiles: utilityProfiles(utilities, placement.targets),
    area,
    units,
    cost: { operating, capital, capitalAnnual, total: operating + capitalAnnual, annualisationFactor: f, capitalNote },
  };
}

export interface SweepPoint {
  dtMin: number;
  qh: number;
  qc: number;
  area: number;
  units: number;
  operating: number;
  capitalAnnual: number;
  total: number;
  /** Why cost could not be computed at this point, if so */
  note?: string;
}

export interface Supertarget {
  points: SweepPoint[];
  /** Point with the lowest total annual cost, if any cost could be computed */
  optimum?: SweepPoint;
}

/** Supertargeting: total annual cost across a range of ΔTmin. */
export function supertarget(project: Project): Supertarget {
  const { min, max, steps } = project.settings.sweep;
  const n = Math.max(2, Math.min(500, Math.round(steps)));
  const lo = Math.max(1e-3, Math.min(min, max));
  const hi = Math.max(min, max);
  const points: SweepPoint[] = [];
  for (let k = 0; k < n; k++) {
    const dt = lo + ((hi - lo) * k) / (n - 1);
    const a = analyse(project, dt);
    points.push({
      dtMin: dt,
      qh: a.pt.qhMin,
      qc: a.pt.qcMin,
      area: a.area.total ?? NaN,
      units: a.units.mer,
      operating: a.cost.operating,
      capitalAnnual: a.cost.capitalAnnual,
      total: a.cost.total,
      note: a.cost.capitalNote,
    });
  }
  let optimum: SweepPoint | undefined;
  for (const p of points) if (Number.isFinite(p.total) && (!optimum || p.total < optimum.total)) optimum = p;
  return { points, optimum };
}
