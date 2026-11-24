import { useEffect, useState, type Dispatch } from 'react';
import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import type { Action } from '../state/actions';
import { analyseNetwork, regionOf, tickOffLoad, unitName, unitTags, type NetworkResult } from '../core/network';
import { GridDiagram } from './GridDiagram';
import { GuidePanel } from './GuidePanel';
import { newId } from '../core/project';
import { NumberField } from './NumberField';
import { conv, money, num } from './format';
import { exchangerFor, utilityDuty, utilityUnitsFor } from './networkHelpers';
import { SplitEditor } from './SplitEditor';

interface Props {
  project: Project;
  analysis: Analysis;
  net: NetworkResult;
  dispatch: Dispatch<Action>;
}

export function DesignView({ project, analysis, net, dispatch }: Props) {
  const c = conv(project.settings.units);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [streamSel, setStreamSel] = useState<string | null>(null);
  const selected = selectedUnit;
  // a unit and a stream are never selected together
  const setSelected = (id: string | null) => {
    setSelectedUnit(id);
    if (id) setStreamSel(null);
  };
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
    const extra = remainingOf(kind).flatMap((s) => utilityUnitsFor(analysis, net, s.id));
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
          onMatch={(hot, cold, x, hb, cb) => {
            const u = exchangerFor(analysis, net, hot, cold, x, hb, cb);
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
            const add = utilityUnitsFor(analysis, net, sid);
            if (!add.length) return;
            guarded(streams.get(sid)!.kind, () => {
              const what = `${add[0].kind}${add.length > 1 ? 's' : ''} on ${streams.get(sid)?.name}`;
              dispatch({ type: 'network/set', units: [...units, ...add], label: `Add ${what}` });
              setSelected(add[0].id);
            });
          }}
          onStreamClick={(sid) => {
            setStreamSel(streamSel === sid ? null : sid);
            setSelectedUnit(null);
          }}
          selectedStream={streamSel}
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
                        // tick-off ignoring this unit's own load
                        const others = analyseNetwork({ ...project, network: { ...project.network, units: units.filter((u) => u.id !== sel.id) } }, analysis, 'pinch');
                        const max = tickOffLoad(others, sel.hot!, sel.cold!, sel.x, sel.hotBranch, sel.coldBranch);
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
                  {(['hot', 'cold'] as const).map((k) => {
                    const sid = k === 'hot' ? sel.hot : sel.cold;
                    const br = sid ? net.streams.get(sid)?.branches?.[regionOf(sel.x, net.hasPinch)] : undefined;
                    if (!sid || !br) return null;
                    const cur = (k === 'hot' ? sel.hotBranch : sel.coldBranch) ?? 0;
                    return (
                      <label key={k}>
                        {streams.get(sid)?.name} branch
                        <select
                          className="field-select"
                          value={Math.min(cur, br.length - 1)}
                          onChange={(e) => dispatch({ type: 'unit/update', id: sel.id, patch: k === 'hot' ? { hotBranch: +e.target.value } : { coldBranch: +e.target.value }, label: 'Change branch' })}
                        >
                          {br.map((b, i) => (
                            <option key={i} value={i}>{`${i + 1} (CP ${num(c.p(b.cp))})`}</option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
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
        {streamSel && !sel && <SplitEditor project={project} analysis={analysis} net={net} streamId={streamSel} dispatch={dispatch} onClose={() => setStreamSel(null)} />}
      </section>

      <GuidePanel
        summary={
          <>
            <div className="compare-cards">
            {rows.map((r) => {
              const over = r.diff !== undefined && Number.isFinite(r.diff) && r.diff > 1e-6;
              // utility duty still short of its target: the design is not finished
              const short = (r.label === 'Hot utility' || r.label === 'Cold utility') && r.diff !== undefined && r.diff < -1e-6;
              return (
                <div key={r.label} className={`compare-card ${short ? 'short' : ''}`} title={short ? `${r.label} target not met yet` : undefined}>
                  <div className="cc-title">{r.label}{r.unit ? <span className="unit"> ({r.unit})</span> : null}</div>
                  <div className="cc-vals">
                    <div><span className="cc-k">Design</span><span className={`cc-v ${over ? 'warn' : ''}`}>{r.design}</span></div>
                    <div><span className="cc-k">Target</span><span className="cc-t">{r.target}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className={`hint ${net.complete ? '' : 'warn'}`}>
            {net.complete
              ? 'All stream duties are met.'
              : units.length
                ? 'The network is not complete yet: some streams still have unmatched duty.'
                : 'No units yet.'}
          </p>
          </>
        }
        project={project}
        analysis={analysis}
        net={net}
        onAdd={(g) => {
          const id = newId('e');
          dispatch({ type: 'unit/add', unit: { id, kind: 'exchanger', hot: g.hot, cold: g.cold, load: +g.load.toFixed(6), x: g.x, hotBranch: g.hotBranch, coldBranch: g.coldBranch }, label: `Add exchanger ${streams.get(g.hot)?.name}–${streams.get(g.cold)?.name} (guide)` });
          setSelected(id);
          if (hasPinch) setSection(g.region);
        }}
        onSplit={(sp) => {
          dispatch({ type: 'split/set', stream: sp.stream, side: sp.region, fractions: sp.fractions, label: `Split ${streams.get(sp.stream)?.name} ${hasPinch ? `${sp.region} the pinch` : ''} (guide)`.replace('  ', ' ') });
          if (hasPinch) setSection(sp.region);
          setSelectedUnit(null);
          setStreamSel(sp.stream);
        }}
        section={hasPinch ? section : null}
      />


    </div>
  );
}
