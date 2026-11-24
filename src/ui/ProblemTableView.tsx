import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import { conv, num } from './format';
import { CascadeDiagram } from './CascadeDiagram';
import { safeFileName } from '../state/storage';

export function ProblemTableView({ project, analysis, part }: { project: Project; analysis: Analysis; part: 'table' | 'cascade' }) {
  const c = conv(project.settings.units);
  const { pt } = analysis;

  if (analysis.streams.length === 0) {
    return <section className="card empty-card">Add at least one valid stream to see the Problem Table.</section>;
  }

  if (part === 'table') return (
      <section className="card">
        <header className="card-head">
          <div>
            <h2>Problem Table</h2>
            <p className="muted">
              Shifted temperatures: hot streams move down and cold streams up by their ΔT contribution (default ΔTmin/2 = {num(analysis.dtMin / 2)} K). Each interval's balance is ΔH = (ΣCP<sub>hot</sub> − ΣCP<sub>cold</sub>) × ΔT.
            </p>
          </div>
        </header>
        <div className="table-wrap">
          <table className="grid-table data">
            <thead>
              <tr>
                <th>Interval</th>
                <th className="r">T* top<br /><span className="unit">{c.tUnit}</span></th>
                <th className="r">T* bottom<br /><span className="unit">{c.tUnit}</span></th>
                <th className="streams-th">Streams</th>
                <th className="r">ΔT<br /><span className="unit">K</span></th>
                <th className="r">ΣCP hot − ΣCP cold<br /><span className="unit">{c.cpUnit}</span></th>
                <th className="r">ΔH<br /><span className="unit">{c.pUnit}</span></th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {pt.intervals.map((iv, i) => (
                <tr key={i} className="pt-row-fixed">
                  <td className="muted">{i + 1}</td>
                  <td className="r">{num(c.t(iv.tTop))}</td>
                  <td className="r">{num(c.t(iv.tBot))}</td>
                  {i === 0 && (
                    <td rowSpan={pt.intervals.length} className="streams-cell">
                      <StreamArrows analysis={analysis} />
                    </td>
                  )}
                  <td className="r">{num(iv.dT)}</td>
                  <td className="r">{num(c.p(iv.netCp), 4)}</td>
                  <td className="r strong">{num(c.p(iv.dH))}</td>
                  <td>{Math.abs(iv.dH) < 1e-9 ? <span className="muted">balanced</span> : iv.dH > 0 ? <span className="tag surplus">surplus</span> : <span className="tag deficit">deficit</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
  );

  return (
      <section className="card">
        <header className="card-head">
          <div>
            <h2>Heat cascade</h2>
            <p className="muted">
              Cascade the interval balances from the top. With zero hot utility the most negative flow sets QH,min; adding it at the top makes every flow non-negative. The flow is zero at the pinch. Flows are shown just below each temperature, after any phase-change (latent) heat released or absorbed at it.
            </p>
          </div>
        </header>
        <div className="cascade-fig"><CascadeDiagram pt={pt} c={c} filename={`${safeFileName(project.name)}_heat_cascade`} /></div>
        <div className="summary-line">
          <span>QH,min = <b>{num(c.p(pt.qhMin))} {c.pUnit}</b></span>
          <span>QC,min = <b>{num(c.p(pt.qcMin))} {c.pUnit}</b></span>
          {pt.pinches.length > 0 ? (
            pt.pinches.map((p, i) => (
              <span key={i}>
                Pinch T* = <b>{num(c.t(p))} {c.tUnit}</b> (hot {num(c.t(p + analysis.dtMin / 2))} / cold {num(c.t(p - analysis.dtMin / 2))} {c.tUnit})
              </span>
            ))
          ) : (
            <span>Threshold problem: no pinch.</span>
          )}
        </div>
      </section>
  );
}

const ROW = 40;

/** Vertical arrows, one per stream, spanning its shifted temperature range across the interval rows. */
function StreamArrows({ analysis }: { analysis: Analysis }) {
  const { pt } = analysis;
  const b = pt.boundaries;
  const idx = (t: number) => {
    let best = 0;
    for (let i = 1; i < b.length; i++) if (Math.abs(b[i] - t) < Math.abs(b[best] - t)) best = i;
    return best;
  };
  const streams = [...analysis.streams.filter((s) => s.kind === 'hot'), ...analysis.streams.filter((s) => s.kind === 'cold')];
  const COL = 30;
  const W = Math.max(60, streams.length * COL + 10);
  const H = (b.length - 1) * ROW;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Stream temperature ranges" className="stream-arrows">
      <defs>
        {(['hot', 'cold'] as const).map((k) => (
          <marker key={k} id={`sa-${k}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto">
            <path d="M0 0L10 5L0 10z" fill={k === 'hot' ? '#e34948' : '#2a78d6'} />
          </marker>
        ))}
      </defs>
      {b.slice(1, -1).map((_, i) => (
        <line key={`g${i}`} x1={0} x2={W} y1={(i + 1) * ROW} y2={(i + 1) * ROW} stroke="#e4e3df" strokeDasharray="3 3" />
      ))}
      {streams.map((s, k) => {
        const x = 14 + k * COL;
        const y1 = idx(s.sTs) * ROW;
        const y2 = idx(s.sTt) * ROW;
        const color = s.kind === 'hot' ? '#e34948' : '#2a78d6';
        const top = Math.min(y1, y2);
        const len = Math.abs(y2 - y1);
        const pad = 3;
        // arrow points from supply to target: down for hot, up for cold
        const from = s.kind === 'hot' ? top + pad : top + len - pad;
        const to = s.kind === 'hot' ? top + len - pad - 6 : top + pad + 6;
        return (
          <g key={s.id}>
            <title>{`${s.name}: ${s.kind === 'hot' ? 'hot' : 'cold'}, ${num(s.sTs)} → ${num(s.sTt)} (shifted)`}</title>
            <line x1={x} x2={x} y1={from} y2={to} stroke={color} strokeWidth="3" strokeLinecap="round" markerEnd={`url(#sa-${s.kind})`} />
            <text x={x + 6} y={top + len / 2} fontSize="11" fontWeight="600" fill={color} transform={`rotate(-90 ${x + 6} ${top + len / 2})`} textAnchor="middle" dominantBaseline="hanging">
              {s.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
