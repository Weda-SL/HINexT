import { Fragment, type Dispatch } from 'react';
import type { CapitalModel, CostParams, Project } from '../core/types';
import type { Analysis, Supertarget } from '../core/analyse';
import type { Action } from '../state/actions';
import { compileExpression } from '../core/expression';
import { NumberField } from './NumberField';
import { Chart } from './Chart';
import { conv, money, num } from './format';
import { safeFileName } from '../state/storage';

interface Props {
  project: Project;
  analysis: Analysis;
  sweep: Supertarget | null;
  dispatch: Dispatch<Action>;
}

const P0: CostParams = { a: 10000, b: 800, c: 0.8 };

function defaultModel(kind: CapitalModel['kind'], from: CapitalModel): CapitalModel {
  const base = from.kind === 'power' ? from.params : from.kind === 'separate' ? from.exchanger : P0;
  switch (kind) {
    case 'power':
      return { kind, params: { ...base } };
    case 'linear':
      return { kind, a: base.a, b: base.b };
    case 'separate':
      return { kind, exchanger: { ...base }, heater: { ...base }, cooler: { ...base } };
    case 'custom':
      return { kind, expression: `${base.a} + ${base.b}*A^${base.c}` };
  }
}

function ParamRow({ label, p, onChange }: { label: string; p: CostParams; onChange: (p: CostParams) => void }) {
  return (
    <div className="param-row">
      <span className="param-label">{label}</span>
      <label>a <NumberField ariaLabel={`${label} a`} value={p.a} onCommit={(v) => onChange({ ...p, a: v })} /></label>
      <label>b <NumberField ariaLabel={`${label} b`} value={p.b} onCommit={(v) => onChange({ ...p, b: v })} /></label>
      <label>c <NumberField ariaLabel={`${label} c`} value={p.c} onCommit={(v) => onChange({ ...p, c: v })} /></label>
    </div>
  );
}

export function TargetsView({ project, analysis, sweep, dispatch }: Props) {
  const c = conv(project.settings.units);
  const { units, area, cost, pt } = analysis;
  const econ = project.economics;
  const cap = econ.capital;
  const setCap = (capital: CapitalModel) => dispatch({ type: 'economics/capital', capital });
  let exprError: string | null = null;
  if (cap.kind === 'custom') {
    try {
      compileExpression(cap.expression);
    } catch (e) {
      exprError = (e as Error).message;
    }
  }

  const pts = sweep?.points ?? [];
  const opt = sweep?.optimum;
  const hasCost = pts.some((p) => Number.isFinite(p.total));
  const missing = pts.filter((p) => !Number.isFinite(p.total));
  const gapNote =
    hasCost && missing.length > 0
      ? `No cost for ${missing.length} of ${pts.length} points (ΔTmin ${num(missing[0].dtMin, 2)}${missing.length > 1 ? `–${num(missing[missing.length - 1].dtMin, 2)}` : ''} K). ${missing[0].note ?? ''}`
      : null;

  return (
    <div className="stack">
      <div className="target-grid">
        <section className="card">
          <h2>Energy</h2>
          <dl className="kv">
            <dt>Hot utility, QH,min</dt><dd>{num(c.p(pt.qhMin))} {c.pUnit}</dd>
            <dt>Cold utility, QC,min</dt><dd>{num(c.p(pt.qcMin))} {c.pUnit}</dd>
            {analysis.utilityTargets.filter((u) => u.duty > 0).map((u) => (
              <Fragment key={u.id}><dt className="indent">{u.name}</dt><dd>{num(c.p(u.duty))} {c.pUnit}</dd></Fragment>
            ))}
            {analysis.unmetHot > 0 && (<><dt className="warn">Unmet hot demand</dt><dd className="warn">{num(c.p(analysis.unmetHot))} {c.pUnit}</dd></>)}
            {analysis.unmetCold > 0 && (<><dt className="warn">Unmet cold demand</dt><dd className="warn">{num(c.p(analysis.unmetCold))} {c.pUnit}</dd></>)}
          </dl>
        </section>
        <section className="card">
          <h2>Units</h2>
          <dl className="kv">
            <dt>Minimum units, MER design</dt><dd>{units.mer}</dd>
            <dt>Minimum units, ignoring the pinch</dt><dd>{units.overall}</dd>
            {units.regions.map((r, i) => (
              <Fragment key={i}><dt className="indent">{units.regions.length === 1 ? 'Whole problem' : i === 0 ? 'Above pinch' : i === units.regions.length - 1 ? 'Below pinch' : `Region ${i + 1}`}</dt>
              <dd>{r.count} streams → {Math.max(0, r.count - 1)} units</dd></Fragment>
            ))}
          </dl>
          <p className="hint">N counts process streams and the utilities in use in each region; U = N − 1 per region (Euler).</p>
        </section>
        <section className="card">
          <h2>Area (Bath formula)</h2>
          <dl className="kv">
            <dt>Total area</dt><dd>{area.total === null ? '—' : `${num(area.total)} m²`}</dd>
            {area.total !== null && Number.isFinite(area.total) && (
              <>
                <dt className="indent">Process exchangers</dt><dd>{num(area.exchanger)} m²</dd>
                <dt className="indent">Heaters</dt><dd>{num(area.heater)} m²</dd>
                <dt className="indent">Coolers</dt><dd>{num(area.cooler)} m²</dd>
              </>
            )}
          </dl>
          {cost.capitalNote ? <p className="hint warn">{cost.capitalNote}</p> : <p className="hint">Vertical heat transfer between the balanced composite curves. The split by unit type is approximate.</p>}
        </section>
      </div>

      <section className="card">
        <header className="card-head">
          <div>
            <h2>Utility costs</h2>
            <p className="muted">Duties come from the targeting on the Energy targets tab. Enter the cost of each utility per kW of duty per year.</p>
          </div>
        </header>
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Utility</th>
                <th>Type</th>
                <th className="r">Duty<br /><span className="unit">{c.pUnit}</span></th>
                <th className="r">Unit cost<br /><span className="unit">$/kW·yr</span></th>
                <th className="r">Annual cost<br /><span className="unit">$/yr</span></th>
              </tr>
            </thead>
            <tbody>
              {project.utilities.length === 0 && (
                <tr><td colSpan={5} className="empty">No utilities defined. Add them on the Energy targets tab.</td></tr>
              )}
              {project.utilities.map((u) => {
                const t = analysis.utilityTargets.find((x) => x.id === u.id);
                return (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td><span className={`badge ${u.kind}`}>{u.kind === 'hot' ? 'Hot' : 'Cold'}</span></td>
                    <td className="r">{t ? num(c.p(t.duty)) : '—'}</td>
                    <td><NumberField ariaLabel={`Unit cost of ${u.name}`} value={u.cost} onCommit={(v) => dispatch({ type: 'utility/update', id: u.id, patch: { cost: v } })} /></td>
                    <td className="r strong">{t ? money(t.opCost) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            {analysis.utilityTargets.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={4} className="r strong">Operating cost</td>
                  <td className="r strong">{money(cost.operating)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Capital cost model</h2>
          <div className="form">
            <label className="field">
              <span>Model</span>
              <select value={cap.kind} onChange={(e) => setCap(defaultModel(e.target.value as CapitalModel['kind'], cap))}>
                <option value="power">Power law: a + b·A^c</option>
                <option value="linear">Linear: a + b·A</option>
                <option value="separate">Separate exchangers, heaters, coolers</option>
                <option value="custom">User-defined expression</option>
              </select>
            </label>
            {cap.kind === 'power' && <ParamRow label="Per unit" p={cap.params} onChange={(params) => setCap({ ...cap, params })} />}
            {cap.kind === 'linear' && (
              <div className="param-row">
                <span className="param-label">Per unit</span>
                <label>a <NumberField ariaLabel="a" value={cap.a} onCommit={(v) => setCap({ ...cap, a: v })} /></label>
                <label>b <NumberField ariaLabel="b" value={cap.b} onCommit={(v) => setCap({ ...cap, b: v })} /></label>
              </div>
            )}
            {cap.kind === 'separate' && (
              <>
                <ParamRow label="Exchangers" p={cap.exchanger} onChange={(exchanger) => setCap({ ...cap, exchanger })} />
                <ParamRow label="Heaters" p={cap.heater} onChange={(heater) => setCap({ ...cap, heater })} />
                <ParamRow label="Coolers" p={cap.cooler} onChange={(cooler) => setCap({ ...cap, cooler })} />
              </>
            )}
            {cap.kind === 'custom' && (
              <label className="field">
                <span>Cost per unit, $ (A = area per unit, m²)</span>
                <input
                  className={`text mono ${exprError ? 'invalid' : ''}`}
                  defaultValue={cap.expression}
                  key={cap.expression}
                  onBlur={(e) => e.target.value !== cap.expression && setCap({ ...cap, expression: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
                {exprError ? <small className="warn">{exprError}</small> : <small className="muted">Use + − * / ^, parentheses, sqrt, ln, exp, min, max.</small>}
              </label>
            )}
            <p className="hint">Cost per unit with A in m²; the area target is shared equally between the minimum number of units.</p>
            <div className="param-row">
              <label>Interest rate, % <NumberField ariaLabel="Interest rate" value={econ.interestRate * 100} onCommit={(v) => dispatch({ type: 'economics/update', patch: { interestRate: v / 100 } })} /></label>
              <label>Plant life, years <NumberField ariaLabel="Plant life" value={econ.plantLife} onCommit={(v) => dispatch({ type: 'economics/update', patch: { plantLife: v } })} /></label>
            </div>
          </div>
        </section>
        <section className="card">
          <h2>Cost targets at ΔTmin = {num(analysis.dtMin)} K</h2>
          <dl className="kv big">
            <dt>Operating cost</dt><dd>{money(cost.operating)}/yr</dd>
            <dt>Capital cost (installed)</dt><dd>{money(cost.capital)}</dd>
            <dt className="indent">Annualisation factor</dt><dd>{num(cost.annualisationFactor, 4)} /yr</dd>
            <dt>Annualised capital</dt><dd>{money(cost.capitalAnnual)}/yr</dd>
            <dt className="total">Total annual cost</dt><dd className="total">{money(cost.total)}/yr</dd>
          </dl>
        </section>
      </div>

      <section className="card">
        <header className="card-head">
          <div>
            <h2>Supertargeting</h2>
            <p className="muted">Total annual cost across a range of ΔTmin. Steps in the curve come from changes in the minimum number of units.</p>
          </div>
          <div className="param-row">
            <label>From, K <NumberField ariaLabel="Sweep from" value={project.settings.sweep.min} onCommit={(v) => v > 0 && dispatch({ type: 'settings/sweep', sweep: { min: v } })} /></label>
            <label>To, K <NumberField ariaLabel="Sweep to" value={project.settings.sweep.max} onCommit={(v) => v > 0 && dispatch({ type: 'settings/sweep', sweep: { max: v } })} /></label>
            <label>Points <NumberField ariaLabel="Sweep points" value={project.settings.sweep.steps} onCommit={(v) => v >= 2 && dispatch({ type: 'settings/sweep', sweep: { steps: Math.round(v) } })} /></label>
          </div>
        </header>
        {!sweep ? (
          <p className="muted">Calculating…</p>
        ) : !hasCost ? (
          <p className="hint warn">{cost.capitalNote ?? 'Costs cannot be calculated for this range.'}</p>
        ) : (
          <>
            <Chart
              title="Total annual cost vs ΔTmin"
              subtitle={opt ? `Optimum ΔTmin ≈ ${num(opt.dtMin, 1)} K, total ${money(opt.total)}/yr` : undefined}
              series={[
                { id: 'tac', label: 'Total annual cost', color: '#2a78d6', points: pts.filter((p) => Number.isFinite(p.total)).map((p) => ({ x: p.dtMin, y: p.total })), width: 2.5 },
                { id: 'op', label: 'Operating cost', color: '#eb6834', points: pts.map((p) => ({ x: p.dtMin, y: p.operating })) },
                { id: 'cap', label: 'Annualised capital', color: '#1baf7a', points: pts.filter((p) => Number.isFinite(p.capitalAnnual)).map((p) => ({ x: p.dtMin, y: p.capitalAnnual })) },
              ]}
              xLabel="ΔTmin (K)"
              yLabel="Cost ($/yr)"
              xFmt={(v) => num(v, 2)}
              yFmt={(v) => money(v)}
              refLines={[{ axis: 'x', value: analysis.dtMin, label: `Current ${num(analysis.dtMin)} K` }]}
              markers={opt ? [{ x: opt.dtMin, y: opt.total, label: 'Optimum', color: '#2a78d6' }] : []}
              filename={`${safeFileName(project.name)}_supertargeting`}
              yZero
            />
            {gapNote && <p className="hint warn">{gapNote}</p>}
            {opt && (
              <div className="summary-line">
                <span>Optimum ΔTmin ≈ <b>{num(opt.dtMin, 2)} K</b></span>
                <span>QH,min <b>{num(c.p(opt.qh))} {c.pUnit}</b></span>
                <span>Area <b>{num(opt.area)} m²</b></span>
                <span>Units <b>{opt.units}</b></span>
                <button className="btn primary small" onClick={() => dispatch({ type: 'settings/dtMin', dtMin: +opt.dtMin.toFixed(2) })}>Use this ΔTmin</button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
