import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import { conv, money, num } from './format';

/** Headline targets at the current ΔTmin, shown as a row of cards. */
export function HeadlineTargets({ project, analysis }: { project: Project; analysis: Analysis }) {
  const c = conv(project.settings.units);
  const { pt } = analysis;
  const pinch = pt.pinches[0];
  return (
    <section className="card" aria-label="Headline targets">
      <h2>Targets at ΔT<sub>min</sub> = {num(analysis.dtMin)} K</h2>
      <div className="kpis">
        <Kpi label="QH,min" value={num(c.p(pt.qhMin))} unit={c.pUnit} tone="hot" />
        <Kpi label="QC,min" value={num(c.p(pt.qcMin))} unit={c.pUnit} tone="cold" />
        <Kpi
          label="Pinch (hot / cold)"
          value={pinch !== undefined ? `${num(c.t(pinch + analysis.dtMin / 2))} / ${num(c.t(pinch - analysis.dtMin / 2))}` : 'none'}
          unit={pinch !== undefined ? c.tUnit : ''}
        />
        <Kpi label="Units (MER)" value={String(analysis.units.mer)} />
        <Kpi label="Area" value={analysis.area.total === null ? '—' : num(analysis.area.total)} unit={analysis.area.total === null ? '' : 'm²'} />
        <Kpi label="Total annual cost" value={money(analysis.cost.total)} unit={Number.isFinite(analysis.cost.total) ? '/yr' : ''} />
      </div>
    </section>
  );
}

function Kpi({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: 'hot' | 'cold' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">
        {value}
        {unit ? <span className="kpi-unit"> {unit}</span> : null}
      </span>
    </div>
  );
}
