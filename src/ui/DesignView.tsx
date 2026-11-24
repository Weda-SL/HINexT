import { useState, type Dispatch } from 'react';
import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import type { Action } from '../state/actions';
import { tickOffLoad, unitName, unitTags, type NetworkResult } from '../core/network';
import { GridDiagram } from './GridDiagram';
import { NumberField } from './NumberField';
import { conv, money, num } from './format';
import { exchangerFor, utilityUnitFor } from './networkHelpers';

interface Props {
  project: Project;
  analysis: Analysis;
  net: NetworkResult;
  dispatch: Dispatch<Action>;
}

export function DesignView({ project, analysis, net, dispatch }: Props) {
  const c = conv(project.settings.units);
  const [selected, setSelected] = useState<string | null>(null);
  const units = project.network?.units ?? [];
  const streams = new Map(analysis.streams.map((s) => [s.id, s]));
  const utils = new Map(analysis.utilities.map((u) => [u.id, u]));
  const tags = unitTags(project.network?.units ?? []);
  const sel = units.find((u) => u.id === selected) ?? null;
  const selRes = net.units.find((r) => r.id === selected);
  const pc = net.pinchCounts;

  const remainingOf = (kind: 'hot' | 'cold') => analysis.streams.filter((s) => s.kind === kind && (net.streams.get(s.id)?.remaining ?? 0) > 1e-9);
  const addRemaining = (kind: 'hot' | 'cold') => {
    const extra = remainingOf(kind).map((s) => utilityUnitFor(analysis, net, s.id)).filter((u) => u !== null);
    if (!extra.length) return;
    const what = kind === 'cold' ? 'heater' : 'cooler';
    dispatch({ type: 'network/set', units: [...units, ...extra], label: `Add ${extra.length} ${what}${extra.length > 1 ? 's' : ''} for remaining duty` });
  };

  const target = {
    qh: analysis.pt.qhMin,
    qc: analysis.pt.qcMin,
    units: analysis.units.mer,
    area: analysis.area.total,
    total: analysis.cost.total,
  };
  const rows: { label: string; design: string; target: string; diff?: number; unit?: string }[] = [
    { label: 'Hot utility', design: num(c.p(net.qh)), target: num(c.p(target.qh)), diff: c.p(net.qh - target.qh), unit: c.pUnit },
    { label: 'Cold utility', design: num(c.p(net.qc)), target: num(c.p(target.qc)), diff: c.p(net.qc - target.qc), unit: c.pUnit },
    { label: 'Units', design: String(net.unitCount), target: `${target.units} (MER)`, diff: net.unitCount - target.units },
    { label: 'Area', design: num(net.area), target: target.area === null ? '—' : num(target.area), diff: target.area === null ? undefined : net.area - target.area, unit: 'm²' },
    { label: 'Total annual cost', design: money(net.total), target: money(target.total), diff: Number.isFinite(target.total) ? net.total - target.total : undefined, unit: '$/yr' },
  ];

  const errors = net.issues.filter((i) => i.level === 'error');
  const warnings = net.issues.filter((i) => i.level === 'warning');

  return (
    <div className="stack">
      <section className="card">
        <header className="card-head">
          <div>
            <h2>Grid diagram</h2>
            <p className="muted">
              Click a hot stream and then a cold stream to place an exchanger there; its load starts at the tick-off value (the smaller of the two streams' unmatched heat on that side of the pinch). Drag units sideways to reorder them. Above and below the pinch are designed separately, so on each side the streams start from the pinch temperatures. Click a coloured pill at the right to add a heater or cooler for one stream's remaining duty, or use Add heaters / Add coolers for all of them.
            </p>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => addRemaining('cold')} disabled={!remainingOf('cold').length} title="Add a heater on every cold stream that still needs heat">
              Add heaters
            </button>
            <button className="btn" onClick={() => addRemaining('hot')} disabled={!remainingOf('hot').length} title="Add a cooler on every hot stream that still needs cooling">
              Add coolers
            </button>
            <button className="btn ghost" disabled={!units.length} onClick={() => { dispatch({ type: 'network/set', units: [], label: 'Clear network' }); setSelected(null); }}>
              Clear
            </button>
          </div>
        </header>
        <GridDiagram
          project={project}
          analysis={analysis}
          net={net}
          selected={selected}
          onSelect={setSelected}
          editable
          onMatch={(hot, cold, x) => {
            const u = exchangerFor(analysis, net, hot, cold, x);
            dispatch({ type: 'unit/add', unit: u, label: `Add exchanger ${streams.get(hot)?.name}–${streams.get(cold)?.name}` });
            setSelected(u.id);
          }}
          onMove={(id, x) => dispatch({ type: 'unit/update', id, patch: { x }, label: 'Move unit' })}
          onAddUtility={(sid) => {
            const u = utilityUnitFor(analysis, net, sid);
            if (u) {
              dispatch({ type: 'unit/add', unit: u, label: `Add ${u.kind} on ${streams.get(sid)?.name}` });
              setSelected(u.id);
            }
          }}
        />
      </section>

      <div className="two-col">
        <section className="card">
          <h2>{sel ? unitName(sel, streams, utils, tags) : 'Selected unit'}</h2>
          {!sel || !selRes ? (
            <p className="muted">Click a unit on the grid to edit its load, see its temperatures and area, or delete it.</p>
          ) : (
            <div className="form">
              <div className="param-row">
                <label>
                  Load, {c.pUnit}
                  <NumberField
                    ariaLabel="Unit load"
                    value={c.p(sel.load)}
                    onCommit={(v) => Number.isFinite(v) && v >= 0 && dispatch({ type: 'unit/update', id: sel.id, patch: { load: c.pIn(v) }, label: `Set load of ${unitName(sel, streams, utils, tags)}` })}
                  />
                </label>
                {sel.kind === 'exchanger' && (
                  <button
                    className="btn small"
                    title="Largest load on this side of the pinch (the smaller unmatched heat of the two streams)"
                    onClick={() => {
                      const others = { ...net, streams: new Map(net.streams) };
                      // tick-off ignoring this unit's own load
                      for (const id of [sel.hot!, sel.cold!]) {
                        const sr = others.streams.get(id)!;
                        others.streams.set(id, sel.x < 0.5 ? { ...sr, remainingAbove: sr.remainingAbove + sel.load } : { ...sr, remainingBelow: sr.remainingBelow + sel.load });
                      }
                      const max = tickOffLoad(others, sel.hot!, sel.cold!, sel.x);
                      dispatch({ type: 'unit/update', id: sel.id, patch: { load: +max.toFixed(6) }, label: `Tick off ${unitName(sel, streams, utils, tags)}` });
                    }}
                  >
                    Tick off
                  </button>
                )}
                {sel.kind !== 'exchanger' && (
                  <label>
                    Utility
                    <select
                      className="field-select"
                      value={sel.utility}
                      onChange={(e) => dispatch({ type: 'unit/update', id: sel.id, patch: { utility: e.target.value }, label: 'Change utility' })}
                    >
                      {analysis.utilities
                        .filter((u) => u.kind === (sel.kind === 'heater' ? 'hot' : 'cold'))
                        .map((u) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                    </select>
                  </label>
                )}
                <button className="btn ghost small danger-text" onClick={() => { dispatch({ type: 'unit/delete', id: sel.id }); setSelected(null); }}>
                  Delete
                </button>
              </div>
              <dl className="kv">
                <dt>Hot side</dt><dd>{num(c.t(selRes.hotIn))} → {num(c.t(selRes.hotOut))} {c.tUnit}</dd>
                <dt>Cold side</dt><dd>{num(c.t(selRes.coldIn))} → {num(c.t(selRes.coldOut))} {c.tUnit}</dd>
                <dt>ΔT hot end / cold end</dt><dd>{num(selRes.dtHot)} / {num(selRes.dtCold)} K</dd>
                <dt>LMTD</dt><dd>{num(selRes.lmtd)} K</dd>
                <dt>U</dt><dd>{num(selRes.u, 4)} kW/m²K</dd>
                <dt>Area</dt><dd>{num(selRes.area)} m²</dd>
                <dt>Capital</dt><dd>{money(selRes.capital)}</dd>
                <dt>Side</dt><dd>{selRes.side === 'above' ? 'Above the pinch' : 'Below the pinch'}</dd>
              </dl>
            </div>
          )}
        </section>

        <section className="card">
          <h2>Design vs targets</h2>
          <table className="grid-table data compare">
            <thead>
              <tr>
                <th />
                <th className="r">Design</th>
                <th className="r">Target</th>
                <th className="r">Difference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}{r.unit ? <span className="unit"> ({r.unit})</span> : null}</td>
                  <td className="r strong">{r.design}</td>
                  <td className="r">{r.target}</td>
                  <td className={`r ${r.diff !== undefined && r.diff > 1e-6 ? 'warn' : ''}`}>
                    {r.diff === undefined || !Number.isFinite(r.diff) ? '—' : r.label === 'Total annual cost' ? money(r.diff) : (r.diff > 0 ? '+' : '') + num(r.diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`hint ${net.complete ? '' : 'warn'}`}>
            {net.complete
              ? 'All stream duties are met.'
              : units.length
                ? 'The network is not complete yet: see the checks below.'
                : 'No units yet.'}
          </p>
        </section>
      </div>

      <section className="card">
        <h2>Checks</h2>
        {pc && (
          <p className="hint">
            Stream count at the pinch: above, {pc.aboveHot} hot ≤ {pc.aboveCold} cold {pc.aboveHot <= pc.aboveCold ? '✓' : '— split a cold stream'}; below, {pc.belowHot} hot ≥ {pc.belowCold} cold {pc.belowHot >= pc.belowCold ? '✓' : '— split a hot stream'}.
          </p>
        )}
        {net.issues.length === 0 ? (
          <p className="muted">{units.length ? 'No problems found.' : 'Place units on the grid to see feasibility checks.'}</p>
        ) : (
          <div className="issues">
            {[...errors, ...warnings].map((i, k) => (
              <div
                key={k}
                className={`issue ${i.level} ${i.unit ? 'clickable' : ''}`}
                onClick={() => i.unit && setSelected(i.unit)}
              >
                <span className="issue-tag">{i.level === 'error' ? 'Error' : 'Check'}</span> {i.message}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
