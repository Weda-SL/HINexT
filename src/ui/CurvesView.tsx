import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import type { Point } from '../core/composites';
import { Chart, type RefLine, type Series } from './Chart';
import { conv, num } from './format';
import { safeFileName } from '../state/storage';

export const COLORS = {
  hot: '#e34948',
  cold: '#2a78d6',
  gcc: '#0b0b0b',
  hotUtil: ['#eb6834', '#eda100', '#e87ba4'],
  coldUtil: ['#1baf7a', '#008300', '#6250d6'],
};

export function CurvesView({ project, analysis }: { project: Project; analysis: Analysis }) {
  const c = conv(project.settings.units);
  const { pt, dtMin } = analysis;
  const base = safeFileName(project.name);
  const xy = (pts: Point[]) => pts.map((p) => ({ x: c.p(p.h), y: c.t(p.t) }));
  const tFmt = (v: number) => num(v, 1);
  const hFmt = (v: number) => num(v);
  const xLabel = `Enthalpy H (${c.pUnit})`;
  const yAct = `Temperature (${c.tUnit})`;
  const ySh = `Shifted temperature T* (${c.tUnit})`;

  if (analysis.streams.length === 0) {
    return <section className="card empty-card">Add at least one valid stream to see the curves.</section>;
  }

  const pinchActual: RefLine[] = pt.pinches.flatMap((p) => [
    { axis: 'y' as const, value: c.t(p + dtMin / 2), label: `Hot pinch ${num(c.t(p + dtMin / 2))} ${c.tUnit}` },
    { axis: 'y' as const, value: c.t(p - dtMin / 2), label: `Cold pinch ${num(c.t(p - dtMin / 2))} ${c.tUnit}`, below: true },
  ]);
  const pinchShifted: RefLine[] = pt.pinches.map((p) => ({ axis: 'y' as const, value: c.t(p), label: `Pinch T* ${num(c.t(p))} ${c.tUnit}` }));
  const energy = `QH,min = ${num(c.p(pt.qhMin))} ${c.pUnit}  ·  QC,min = ${num(c.p(pt.qcMin))} ${c.pUnit}  ·  ΔTmin = ${num(dtMin)} K`;

  const comp: Series[] = [
    { id: 'hot', label: 'Hot composite', color: COLORS.hot, points: xy(analysis.composites.hot) },
    { id: 'cold', label: 'Cold composite', color: COLORS.cold, points: xy(analysis.composites.cold) },
  ];
  const shifted: Series[] = [
    { id: 'hot', label: 'Shifted hot composite', color: COLORS.hot, points: xy(analysis.shiftedComposites.hot) },
    { id: 'cold', label: 'Shifted cold composite', color: COLORS.cold, points: xy(analysis.shiftedComposites.cold) },
  ];
  let hi = 0;
  let ci = 0;
  const gcc: Series[] = [
    { id: 'gcc', label: 'Grand composite curve', color: COLORS.gcc, points: xy(analysis.gcc) },
    ...analysis.utilityProfiles.map((u) => ({
      id: u.id,
      label: `${u.name} (${num(c.p(u.points[1].h - u.points[0].h))} ${c.pUnit})`,
      color: u.kind === 'hot' ? COLORS.hotUtil[hi++ % 3] : COLORS.coldUtil[ci++ % 3],
      points: xy(u.points),
      width: 3,
    })),
  ];
  const balanced: Series[] = [
    { id: 'bh', label: 'Hot composite + hot utilities', color: COLORS.hot, points: xy(analysis.area.hotCurve) },
    { id: 'bc', label: 'Cold composite + cold utilities', color: COLORS.cold, points: xy(analysis.area.coldCurve) },
  ];
  const showBalanced = analysis.area.hotCurve.length > 0 && analysis.area.coldCurve.length > 0 && analysis.utilityTargets.some((u) => u.duty > 0);

  return (
    <div className="chart-grid">
      <section className="card">
        <Chart title="Composite curves" subtitle={energy} series={comp} xLabel={xLabel} yLabel={yAct} xFmt={hFmt} yFmt={tFmt} refLines={pinchActual} filename={`${base}_composite_curves`} xZero />
      </section>
      <section className="card">
        <Chart title="Shifted composite curves" subtitle="The shifted curves touch at the pinch" series={shifted} xLabel={xLabel} yLabel={ySh} xFmt={hFmt} yFmt={tFmt} refLines={pinchShifted} filename={`${base}_shifted_composites`} xZero />
      </section>
      <section className="card">
        <Chart
          title="Grand composite curve"
          subtitle={analysis.utilityProfiles.length ? 'Utility levels placed against the GCC (shifted temperatures)' : 'Add utilities to see them placed on the GCC'}
          series={gcc}
          xLabel={`Net heat flow (${c.pUnit})`}
          yLabel={ySh}
          xFmt={hFmt}
          yFmt={tFmt}
          refLines={pinchShifted}
          filename={`${base}_grand_composite`}
          xZero
        />
      </section>
      {showBalanced && (
        <section className="card">
          <Chart
            title="Balanced composite curves"
            subtitle="Process streams plus targeted utilities; used for the area target"
            series={balanced}
            xLabel={xLabel}
            yLabel={yAct}
            xFmt={hFmt}
            yFmt={tFmt}
            filename={`${base}_balanced_composites`}
            xZero
          />
        </section>
      )}
    </div>
  );
}
