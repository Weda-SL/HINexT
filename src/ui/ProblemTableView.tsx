import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import { conv, num } from './format';
import { CascadeDiagram } from './CascadeDiagram';

export function ProblemTableView({ project, analysis, part }: { project: Project; analysis: Analysis; part: 'table' | 'cascade' }) {
  const c = conv(project.settings.units);
  const { pt } = analysis;
  const names = new Map(analysis.streams.map((s) => [s.id, s.name]));
  const pinchSet = new Set(pt.pinches);
  const latent = new Map(pt.latent.map((l) => [l.t, l]));
  const hasLatent = pt.latent.length > 0;

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
                <th>Streams present</th>
                <th className="r">ΔT<br /><span className="unit">K</span></th>
                <th className="r">ΣCP hot − ΣCP cold<br /><span className="unit">{c.cpUnit}</span></th>
                <th className="r">ΔH<br /><span className="unit">{c.pUnit}</span></th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {pt.intervals.map((iv, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td className="r">{num(c.t(iv.tTop))}</td>
                  <td className="r">{num(c.t(iv.tBot))}</td>
                  <td>
                    <div className="pills">
                      {iv.hotIds.map((id) => <span key={id} className="pill hot">{names.get(id)}</span>)}
                      {iv.coldIds.map((id) => <span key={id} className="pill cold">{names.get(id)}</span>)}
                      {iv.hotIds.length + iv.coldIds.length === 0 && <span className="muted">none</span>}
                    </div>
                  </td>
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
              Cascade the interval balances from the top. With zero hot utility the most negative flow sets QH,min; adding it at the top makes every flow non-negative. The flow is zero at the pinch. Flows are shown just below each temperature, after any phase-change heat released (+) or absorbed (−) at it.
            </p>
          </div>
        </header>
        <div className="cascade-grid">
        <div className="table-wrap">
            <table className="grid-table data narrow">
              <thead>
                <tr>
                  <th className="r">T*<br /><span className="unit">{c.tUnit}</span></th>
                  <th className="r">Flow, no hot utility<br /><span className="unit">{c.pUnit}</span></th>
                  {hasLatent && <th className="r">Phase change at T*<br /><span className="unit">{c.pUnit}</span></th>}
                  <th className="r">Feasible flow<br /><span className="unit">{c.pUnit}</span></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pt.boundaries.map((t, i) => {
                  const isPinch = pinchSet.has(t);
                  return (
                    <tr key={i} className={isPinch ? 'pinch-row' : ''}>
                      <td className="r">{num(c.t(t))}</td>
                      <td className={`r ${pt.infeasible[i] < -1e-9 ? 'neg' : ''}`}>{num(c.p(pt.infeasible[i]))}</td>
                      {hasLatent && (
                        <td className="r">
                          {latent.has(t) ? (
                            <span title={[...latent.get(t)!.hotIds, ...latent.get(t)!.coldIds].map((id) => names.get(id)).join(', ')}>
                              {latent.get(t)!.hot > 0 && <span className="tag surplus">+{num(c.p(latent.get(t)!.hot))}</span>}
                              {latent.get(t)!.cold > 0 && <span className="tag deficit">−{num(c.p(latent.get(t)!.cold))}</span>}
                            </span>
                          ) : null}
                        </td>
                      )}
                      <td className="r strong">{num(c.p(pt.feasible[i]))}</td>
                      <td>
                        {i === 0 && <span className="tag hot-u">QH,min in</span>}
                        {i === pt.boundaries.length - 1 && <span className="tag cold-u">QC,min out</span>}
                        {isPinch && <span className="tag pinch">Pinch</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="cascade-fig"><CascadeDiagram pt={pt} c={c} /></div>
        </div>
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
