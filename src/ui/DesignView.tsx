import { useEffect, useState, type Dispatch } from 'react';
import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import type { Action } from '../state/actions';
import { tickOffLoad, unitName, unitTags, type NetworkResult } from '../core/network';
import { GridDiagram } from './GridDiagram';
import { GuidePanel } from './GuidePanel';
import { newId } from '../core/project';
import { NumberField } from './NumberField';
import { conv, money, num } from './format';
import { exchangerFor, utilityDuty, utilityUnitFor } from './networkHelpers';

interface Props {
  project: Project;
  analysis: Analysis;
  net: NetworkResult;
  dispatch: Dispatch<Action>;
}

export function DesignView({ project, analysis, net, dispatch }: Props) {
  const c = conv(project.settings.units);
  const [selected, setSelected] = useState<string | null>(null);
  const [section, setSection] = useState<'above' | 'below' | null>(null);
  const hasPinch = analysis.pt.pinches.length > 0;
  // clicking outside the grid (except buttons, the guide and the unit editor) leaves the side
  useEffect(() => {
    if (!section) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || t.closest('[data-keep-section], svg.grid-svg, button, .confirm-bar, [role="menu"]')) return;
      setSection(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [section]);
  const units = project.network?.units ?? [];
  const streams = new Map(analysis.streams.map((s) => [s.id, s]));
  const utils = new Map(analysis.utilities.map((u) => [u.id, u]));
  const tags = unitTags(project.network?.units ?? []);
  const sel = units.find((u) => u.id === selected) ?? null;
  const selRes = net.units.find((r) => r.id === selected);

  const remainingOf = (kind: 'hot' | 'cold') => analysis.streams.filter((s) => s.kind === kind && utilityDuty(analysis, net, s.id) > 1e-9);
  const [confirm, setConfirm] = useState<{ message: string; run: () => void } | null>(null);
  /** Heat still unmatched on the other side's streams in the region where the utility would go */
  const unmatchedFor = (kind: 'hot' | 'cold') => {
    // heaters (on cold streams) go above the pinch: check hot streams above; coolers (on hot streams) go below: check cold streams below
    if (!analysis.pt.pinches.length) return [];
    const other = kind === 'cold' ? 'hot' : 'cold';
    return analysis.streams
      .filter((s) => s.kind === other)
      .map((s) => ({ s, q: kind === 'cold' ? net.streams.get(s.id)?.remainingAbove ?? 0 : net.streams.get(s.id)?.remainingBelow ?? 0 }))
      .filter((r) => r.q > 1e-6);
  };
  const guarded = (kind: 'hot' | 'cold', run: () => void) => {
    const left = unmatchedFor(kind);
    if (!left.length) return run();
    const list = left.map((r) => `${r.s.name} (${num(c.p(r.q))} ${c.pUnit})`).join(', ');
    const message =
      kind === 'cold'
        ? `Hot streams above the pinch still have heat to give: ${list}. Match them with cold streams first; otherwise the heaters take duty that process heat could cover and that heat ends up crossing the pinch or going to cooling.`
        : `Cold streams below the pinch still need heat: ${list}. Match them with hot streams first; otherwise the coolers remove heat these streams could use and they need heating below the pinch.`;
    setConfirm({ message, run });
  };
  const addRemaining = (kind: 'hot' | 'cold') => guarded(kind, () => addRemainingNow(kind));
  const addRemainingNow = (kind: 'hot' | 'cold') => {
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


  return (
    <div className="stack">
      <section className="card">
        <header className="card-head">
          <div>
            <h2>Grid diagram</h2>
            <p className="muted">
              Click a hot stream and then a cold stream to place an exchanger there; its load starts at the tick-off value (the smaller of the two streams' unmatched heat on that side of the pinch). Drag units sideways to reorder them. To delete a unit, click it and press the × above it or the Delete key. Above and below the pinch are designed separately, so on each side the streams start from the pinch temperatures. Click the side of the pinch you are working on (or its label) to focus on it; the other side is muted. Heaters are offered when you work above the pinch and coolers below it: click a coloured pill for one stream or use Add heaters / Add coolers for all of them. Esc leaves the side.
            </p>
          </div>
        </header>
        <GridDiagram
          project={project}
          analysis={analysis}
          net={net}
          selected={selected}
          onSelect={setSelected}
          editable
          utilityDuty={(sid) => utilityDuty(analysis, net, sid)}
          onMatch={(hot, cold, x) => {
            const u = exchangerFor(analysis, net, hot, cold, x);
            dispatch({ type: 'unit/add', unit: u, label: `Add exchanger ${streams.get(hot)?.name}–${streams.get(cold)?.name}` });
            setSelected(u.id);
          }}
          onMove={(id, x) => dispatch({ type: 'unit/update', id, patch: { x }, label: 'Move unit' })}
          section={hasPinch ? section : null}
          actions={
            <>
            {(!hasPinch || section === 'above') && (
                <button className="btn" onClick={() => addRemaining('cold')} disabled={!remainingOf('cold').length} title="Add a heater for each cold stream's unmatched heat above the pinch">
                  Add heaters
                </button>
              )}
              {(!hasPinch || section === 'below') && (
                <button className="btn" onClick={() => addRemaining('hot')} disabled={!remainingOf('hot').length} title="Add a cooler for each hot stream's unmatched heat below the pinch">
                  Add coolers
                </button>
              )}
            </>
          }
          onSection={hasPinch ? setSection : undefined}
          onDelete={(id) => {
            dispatch({ type: 'unit/delete', id });
            setSelected(null);
          }}
          onAddUtility={(sid) => {
            const u = utilityUnitFor(analysis, net, sid);
            if (u) {
              guarded(streams.get(sid)!.kind, () => {
                dispatch({ type: 'unit/add', unit: u, label: `Add ${u.kind} on ${streams.get(sid)?.name}` });
                setSelected(u.id);
              });
            }
          }}
        />
        {confirm && (
          <div className="confirm-bar" role="alertdialog">
            <span className="confirm-icon">⚠</span>
            <span className="confirm-msg">{confirm.message}</span>
            <div className="btn-row">
              <button className="btn small" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn small primary" onClick={() => { confirm.run(); setConfirm(null); }}>Add anyway</button>
            </div>
          </div>
        )}
        {sel && selRes && (
          <div className="unit-panel" data-keep-section>
            <h3>{unitName(sel, streams, utils, tags)}</h3>
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
                </div>
                <dl className="kv kv-major">
                  <dt>Hot side</dt><dd>{num(c.t(selRes.hotIn))} → {num(c.t(selRes.hotOut))} {c.tUnit}<span className="kv-dt" title="Temperature difference at the hot end (hot in − cold out)">ΔT {num(selRes.dtHot)} K</span></dd>
                  <dt>Cold side</dt><dd>{num(c.t(selRes.coldIn))} → {num(c.t(selRes.coldOut))} {c.tUnit}<span className="kv-dt" title="Temperature difference at the cold end (hot out − cold in)">ΔT {num(selRes.dtCold)} K</span></dd>
                  <dt>LMTD</dt><dd>{num(selRes.lmtd)} K</dd>
                </dl>
                <dl className="kv kv-minor">
                  <div><dt>U</dt><dd>{num(selRes.u, 4)} kW/m²K</dd></div>
                  <div><dt>Area</dt><dd>{num(selRes.area)} m²</dd></div>
                  <div><dt>Capital</dt><dd>{money(selRes.capital)}</dd></div>
                </dl>
              </div>
          </div>
        )}
      </section>

      <GuidePanel
        project={project}
        analysis={analysis}
        net={net}
        onAdd={(g) => {
          const id = newId('e');
          dispatch({ type: 'unit/add', unit: { id, kind: 'exchanger', hot: g.hot, cold: g.cold, load: +g.load.toFixed(6), x: g.x }, label: `Add exchanger ${streams.get(g.hot)?.name}–${streams.get(g.cold)?.name} (guide)` });
          setSelected(id);
          if (hasPinch) setSection(g.region);
        }}
        section={hasPinch ? section : null}
      />

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
  );
}
