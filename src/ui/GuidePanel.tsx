import { useMemo, useState, type ReactNode } from 'react';
import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import type { NetworkResult } from '../core/network';
import { designGuide, type RegionGuide, type Suggestion } from '../core/guide';
import { conv, num } from './format';

interface Props {
  project: Project;
  analysis: Analysis;
  net: NetworkResult;
  onAdd: (s: Suggestion) => void;
  /** Design vs targets summary shown at the top */
  summary?: ReactNode;
  /** Side being worked on; the other column is muted */
  section?: 'above' | 'below' | null;
}

export function GuidePanel({ project, analysis, net, onAdd, section, summary }: Props) {
  const c = conv(project.settings.units);
  const guide = useMemo(() => designGuide(project, analysis, net), [project, analysis, net]);
  const [showAll, setShowAll] = useState(false);
  const name = (id: string) => analysis.streams.find((s) => s.id === id)?.name ?? id;

  const region = (r: RegionGuide) => {
    const above = r.region === 'above';
    const feasible = r.suggestions.filter((s) => s.feasible);
    const infeasible = r.suggestions.filter((s) => !s.feasible);
    const title = guide.pinch ? (above ? 'Above the pinch' : 'Below the pinch') : 'Whole problem (no pinch)';
    const pinchPhase = r.pinchHot.length > 0 && r.pinchCold.length > 0;
    let status: string;
    if (r.remainingHot <= 1e-6 && r.remainingCold <= 1e-6) status = 'Complete.';
    else if (above && r.remainingHot <= 1e-6) status = `All hot heat is used. The remaining ${num(c.p(r.remainingCold))} ${c.pUnit} on cold streams is for heaters.`;
    else if (!above && r.remainingCold <= 1e-6) status = `All cold demand is met. The remaining ${num(c.p(r.remainingHot))} ${c.pUnit} on hot streams is for coolers.`;
    else if (pinchPhase) status = 'Start at the pinch: these matches touch the pinch on both streams.';
    else status = 'Pinch matches done. Away from the pinch the choice is free, as long as ΔT ≥ ΔTmin.';
    return (
      <div className={`guide-col ${section && section !== r.region ? 'muted-col' : ''}`} key={r.region}>
        <h3>{title}</h3>
        <p className="hint">{status}</p>
        {guide.pinch && net.pinchCounts && (() => {
          const pc = net.pinchCounts!;
          const h = above ? pc.aboveHot : pc.belowHot;
          const k = above ? pc.aboveCold : pc.belowCold;
          const ok = above ? h <= k : h >= k;
          return (
            <p className={`hint ${ok ? '' : 'warn'}`}>
              Number rule at the pinch: {h} hot {above ? '≤' : '≥'} {k} cold {ok ? '✓' : `✗ — split a ${above ? 'cold' : 'hot'} stream (splitting comes next)`}
            </p>
          );
        })()}
        {feasible.length > 0 && (
          <div className="guide-list">
            {(showAll ? feasible : feasible.slice(0, 3)).map((s, i) => (
              <div key={`${s.hot}-${s.cold}`} className={`guide-item ${i === 0 ? 'best' : ''}`}>
                <div>
                  <div className="guide-title">
                    <span className="g-hot">{name(s.hot)}</span> → <span className="g-cold">{name(s.cold)}</span>
                    <b> · {num(c.p(s.load))} {c.pUnit}</b>
                    {i === 0 && <span className="tag pinch">suggested</span>}
                  </div>
                  <div className="guide-why">
                    {s.pinchMatch && `Pinch match, CP ${num(c.p(s.cpHot))} ${above ? '≤' : '≥'} ${num(c.p(s.cpCold))} ✓ · `}
                    {s.ticksOff.length ? `ticks off ${s.ticksOff.map(name).join(' and ')}` : 'partial load'} · ΔT {num(s.dt)} K
                  </div>
                </div>
                <button className="btn small primary" onClick={() => onAdd(s)}>Add</button>
              </div>
            ))}
          </div>
        )}
        {feasible.length > 3 && (
          <button className="btn ghost small" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show ${feasible.length - 3} more`}</button>
        )}
        {infeasible.length > 0 && (
          <details className="guide-bad">
            <summary>{infeasible.length} match{infeasible.length > 1 ? 'es' : ''} to avoid</summary>
            {infeasible.map((s) => (
              <div key={`${s.hot}-${s.cold}`} className="guide-why">
                {name(s.hot)} → {name(s.cold)}: {s.problem}
              </div>
            ))}
          </details>
        )}
      </div>
    );
  };

  return (
    <section className="card guide-card" data-keep-section aria-label="Design guide">
      {summary && <div className="guide-summary">{summary}</div>}
      <div className="guide-grid">{guide.regions.map(region)}</div>
      <div className="guide-help">
      <details className="guide-rules">
        <summary>Using the grid</summary>
        <ul>
          <li>Click a hot stream, then a cold stream, to place an exchanger there. Its load starts at the tick-off value: the smaller of the two streams' unmatched heat on that side of the pinch.</li>
          <li>Drag a unit sideways to reorder it.</li>
          <li>To delete a unit, click it and press the × above it or the Delete key.</li>
          <li>Above and below the pinch are designed separately, so on each side the streams start from the pinch temperatures.</li>
          <li>Click the side you are working on, or its label, to focus on it; the other side is muted. Click outside the grid or press Esc to leave it.</li>
          <li>Heaters are offered above the pinch and coolers below it: click a coloured pill for one stream, or use Add heaters / Add coolers for all of them.</li>
        </ul>
      </details>
      <details className="guide-rules">
        <summary>The rules being applied</summary>
        <ol>
          <li>Design above and below the pinch separately, starting at the pinch and working away from it.</li>
          <li>Pinch matches must satisfy the CP rule: above the pinch CP hot ≤ CP cold; below it CP hot ≥ CP cold.</li>
          <li>Number rule at the pinch: above, hot streams ≤ cold streams; below, hot ≥ cold. If not, split a stream.</li>
          <li>Tick off: give each match the largest load possible, so one of the two streams is finished on that side.</li>
          <li>Away from the pinch any match is allowed if ΔT ≥ ΔTmin.</li>
          <li>Heaters only above the pinch, coolers only below it, and no heat across the pinch.</li>
        </ol>
      </details>
      </div>
    </section>
  );
}
