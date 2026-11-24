import { useEffect, useMemo, useState, type Dispatch } from 'react';
import type { NetUnit, Network, Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import type { Action } from '../state/actions';
import { analyseNetwork, unitName, unitTags, type NetworkResult } from '../core/network';
import { applyShift, breakLoop, endsFor, findLoops, findPaths, loopCount, maxShift, solveShift, type Loop, type UtilityPath } from '../core/evolution';
import { GridDiagram } from './GridDiagram';
import { NumberField } from './NumberField';
import { conv, money, num } from './format';

interface Props {
  project: Project;
  analysis: Analysis;
  net: NetworkResult;
  /** The MER design on the HEN design tab, to notice when it has changed since evolution started */
  design?: Network;
  dispatch: Dispatch<Action>;
}

type Pick = { kind: 'loop' | 'path'; index: number } | null;

const LOOP_COLOR = '#4b3cc0';
const PATH_COLOR = '#eb6834';

export function EvolutionView({ project, design, analysis, net, dispatch }: Props) {
  const c = conv(project.settings.units);
  const units = useMemo(() => project.network?.units ?? [], [project.network]);
  const streams = new Map(analysis.streams.map((s) => [s.id, s]));
  const utils = new Map(analysis.utilities.map((u) => [u.id, u]));
  const tags = unitTags(project.network?.units ?? []);
  const nodeName = (id: string) => {
    const [sid, b] = id.split('#');
    const n = streams.get(sid)?.name ?? utils.get(sid)?.name ?? sid;
    return b ? `${n} (branch ${b})` : n;
  };
  const ends = useMemo(() => endsFor(project, analysis.pt.pinches.length > 0), [project, analysis]);
  /** Short unit tag as on the grid: E1, H1, C1 */
  const tagOf = (id: string) => tags.get(id) ?? id;
  const unitLabel = (id: string) => {
    const u = units.find((v) => v.id === id);
    return u ? unitName(u, streams, utils, tags) : id;
  };

  const lc = loopCount(units, ends);
  const loops = useMemo(() => findLoops(units, ends), [units, ends]);
  const paths = useMemo(() => findPaths(units, project, ends), [units, project, ends]);
  const [pick, setPick] = useState<Pick>(null);
  const [x, setX] = useState(0);
  const [solveFor, setSolveFor] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const item: Loop | UtilityPath | undefined = pick ? (pick.kind === 'loop' ? loops[pick.index] : paths[pick.index]) : undefined;
  // For a loop, orient the signs so that the smallest unit is reduced (the "break" direction).
  const brk = useMemo(() => (item?.kind === 'loop' ? breakLoop(units, item) : null), [item, units]);
  const signs = brk ? brk.signs : item?.signs;

  // reset x when the selection changes
  useEffect(() => {
    setNote(null);
    if (!item) return;
    if (brk) setX(brk.x);
    else {
      setX(0);
      const worst = net.units.filter((r) => item.edges.includes(r.id) && r.kind === 'exchanger').sort((a, b) => Math.min(a.dtHot, a.dtCold) - Math.min(b.dtHot, b.dtCold))[0];
      setSolveFor(worst?.id ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick?.kind, pick?.index, units]);

  const preview: NetUnit[] | null = item && signs ? applyShift(units, signs, x) : null;
  const previewNet = useMemo(
    () => (preview ? analyseNetwork({ ...project, network: { ...project.network, units: preview } }, analysis) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(preview), project, analysis],
  );
  const shown = previewNet ?? net;
  const shownProject = preview ? { ...project, network: { ...project.network, units: preview } } : project;
  const xMax = item && signs ? maxShift(units, signs) : 0;

  const highlight = item && signs ? { units: new Map([...signs].filter(([id]) => preview?.some((u) => u.id === id) ?? true)), color: item.kind === 'loop' ? LOOP_COLOR : PATH_COLOR } : undefined;

  const minDt = (n: NetworkResult) => Math.min(...n.units.filter((r) => r.load > 0).map((r) => Math.min(r.dtHot, r.dtCold)));

  const apply = () => {
    if (!item || !preview) return;
    const label =
      item.kind === 'loop'
        ? `Break loop ${item.nodes.map(nodeName).join('–')} with x = ${num(c.p(x))} ${c.pUnit}`
        : `Relax path ${item.nodes.map(nodeName).join(' → ')} with x = ${num(c.p(x))} ${c.pUnit}`;
    dispatch({ type: 'evolution/apply', units: preview, label });
    setPick(null);
  };

  const history = project.evolution ?? [];
  const historyRows = useMemo(
    () =>
      history.map((h) => {
        const n = analyseNetwork({ ...project, network: { ...project.network, units: h.units } }, analysis);
        return { h, n };
      }),
    [history, project, analysis],
  );

  if (!units.length) {
    return <section className="card empty-card">Design a network on the HEN design tab first. Evolution then simplifies it by breaking loops and relaxing along utility paths.</section>;
  }

  const designChanged =
    history.length > 0 && (JSON.stringify(history[0].units) !== JSON.stringify(design?.units ?? []) || JSON.stringify(project.network?.splits ?? []) !== JSON.stringify(design?.splits ?? []));

  return (
    <div className="stack">
      {designChanged && (
        <div className="confirm-bar" role="status">
          <span className="confirm-icon">⚠</span>
          <span className="confirm-msg">The MER design on the HEN design tab has changed since you started optimizing. These steps still work on the earlier design.</span>
          <button className="btn small primary" onClick={() => dispatch({ type: 'evolution/clear' })}>Start again from the new design</button>
        </div>
      )}
      <section className="card">
        <header className="card-head">
          <div>
            <h2>Network {preview ? '(preview)' : history.length > 1 ? `(step ${history.length - 1})` : ''}</h2>
            <p className="muted">Optimization works on its own copy of the MER design, so the HEN design tab keeps the design as you built it.</p>
            <p className="muted">
              Euler's theorem: loops L = U − N + S = {lc.units} − {lc.nodes} + {lc.components} = <b>{lc.loops}</b>{project.network?.splits?.length ? ' (each branch of a split stream counts as its own node, since its share of the flow is fixed)' : ''}. Pick a loop or a utility path below; the units it shifts are ringed and marked +x / −x. The grid shows the network with the current x until you apply it.
            </p>
          </div>
        </header>
        <GridDiagram project={shownProject} analysis={analysis} net={shown} selected={selected} onSelect={setSelected} highlight={highlight} />
      </section>

      <div className="two-col">
        <section className="card">
          <h2>Loops ({loops.length})</h2>
          {loops.length === 0 ? (
            <p className="muted">No loops. {lc.loops > 0 ? 'Some loops are longer than the search limit.' : ''}</p>
          ) : (
            <div className="pick-list">
              {loops.map((l, i) => (
                <button key={i} className={`pick ${pick?.kind === 'loop' && pick.index === i ? 'on loop' : ''}`} onClick={() => setPick(pick?.kind === 'loop' && pick.index === i ? null : { kind: 'loop', index: i })}>
                  <span className="pick-title">L{i + 1}: {l.edges.map(tagOf).join(' – ')}</span>
                  <span className="pick-sub">{l.edges.length} units, through {[...new Set(l.nodes.slice(0, -1))].map(nodeName).join(', ')}</span>
                </button>
              ))}
            </div>
          )}
          <h2 className="mt">Utility paths ({paths.length})</h2>
          {paths.length === 0 ? (
            <p className="muted">No path from a hot utility to a cold utility.</p>
          ) : (
            <div className="pick-list">
              {paths.map((pth, i) => (
                <button key={i} className={`pick ${pick?.kind === 'path' && pick.index === i ? 'on path' : ''}`} onClick={() => setPick(pick?.kind === 'path' && pick.index === i ? null : { kind: 'path', index: i })}>
                  <span className="pick-title">P{i + 1}: {nodeName(pth.nodes[0])} → {pth.edges.map(tagOf).join(' → ')} → {nodeName(pth.nodes[pth.nodes.length - 1])}</span>
                  <span className="pick-sub">{pth.edges.length} units, through {pth.nodes.slice(1, -1).map(nodeName).join(', ')}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          {!item || !signs ? (
            <>
              <h2>Shift load</h2>
              <p className="muted">Select a loop to break it, or a utility path to relax ΔT violations. Breaking a loop removes a unit but usually creates a ΔTmin violation; relaxing along a path restores ΔTmin at the cost of extra utility.</p>
            </>
          ) : (
            <>
              <h2>{item.kind === 'loop' ? `Break loop L${pick!.index + 1}` : `Relax path P${pick!.index + 1}`}</h2>
              <p className="muted">
                {item.kind === 'loop'
                  ? `Units marked +x gain load and −x lose it, so every stream keeps its duty. x = ${num(c.p(brk!.x))} ${c.pUnit} removes ${unitLabel(brk!.removes)}, the smallest unit in the loop.`
                  : 'Heaters and coolers on the path gain x; the exchangers between them alternate −x / +x. Hot and cold utility both rise by x.'}
              </p>
              <div className="param-row">
                <label>
                  x, {c.pUnit}
                  <NumberField ariaLabel="Shift x" value={c.p(x)} onCommit={(v) => Number.isFinite(v) && v >= 0 && setX(Math.min(c.pIn(v), xMax))} />
                </label>
                {Number.isFinite(xMax) && xMax > 0 && (
                  <input
                    type="range"
                    className="x-slider"
                    aria-label="Drag x"
                    min={0}
                    max={xMax}
                    step={xMax / 400}
                    value={Math.min(x, xMax)}
                    onChange={(e) => setX(+e.target.value)}
                  />
                )}
                <span className="muted small">max {Number.isFinite(xMax) ? num(c.p(xMax)) : '—'}</span>
                {item.kind === 'loop' && <button className="btn small" onClick={() => setX(brk!.x)}>Remove smallest unit</button>}
              </div>
              {item.kind === 'path' && (
                <div className="param-row">
                  <label>
                    Restore ΔTmin on
                    <select className="field-select" value={solveFor} onChange={(e) => setSolveFor(e.target.value)}>
                      <option value="">every unit</option>
                      {item.edges.map((id) => (
                        <option key={id} value={id}>{unitLabel(id)}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="btn small primary"
                    onClick={() => {
                      const r = solveShift(project, analysis, units, signs, solveFor || undefined);
                      if (r === null) setNote('No x on this path restores ΔTmin there. Try another path or unit.');
                      else {
                        setNote(null);
                        setX(r);
                      }
                    }}
                  >
                    Solve x
                  </button>
                </div>
              )}
              {note && <p className="hint warn">{note}</p>}
              {previewNet && (
                <table className="grid-table data compare">
                  <thead>
                    <tr><th /><th className="r">Now</th><th className="r">After</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Units</td><td className="r">{net.unitCount}</td><td className="r strong">{previewNet.unitCount}</td></tr>
                    <tr><td>Hot utility ({c.pUnit})</td><td className="r">{num(c.p(net.qh))}</td><td className="r strong">{num(c.p(previewNet.qh))}</td></tr>
                    <tr><td>Cold utility ({c.pUnit})</td><td className="r">{num(c.p(net.qc))}</td><td className="r strong">{num(c.p(previewNet.qc))}</td></tr>
                    <tr><td>Area (m²)</td><td className="r">{num(net.area)}</td><td className="r strong">{num(previewNet.area)}</td></tr>
                    <tr><td>Smallest ΔT (K)</td><td className="r">{num(minDt(net))}</td><td className={`r strong ${minDt(previewNet) < analysis.dtMin - 1e-6 ? 'warn' : ''}`}>{num(minDt(previewNet))}</td></tr>
                    <tr><td>Total annual cost</td><td className="r">{money(net.total)}</td><td className="r strong">{money(previewNet.total)}</td></tr>
                  </tbody>
                </table>
              )}
              {previewNet && previewNet.issues.filter((i) => i.unit && !i.message.includes('across the pinch') && !i.message.includes('below the pinch') && !i.message.includes('above the pinch')).length > 0 && (
                <div className="issues mt-s">
                  {previewNet.issues
                    .filter((i) => i.unit && !i.message.includes('across the pinch') && !i.message.includes('below the pinch') && !i.message.includes('above the pinch'))
                    .map((i, k) => (
                      <div key={k} className={`issue ${i.level}`}>{i.message}</div>
                    ))}
                </div>
              )}
              <div className="btn-row mt-s">
                <button className="btn primary" onClick={apply} disabled={x <= 0}>Apply step</button>
                <button className="btn ghost" onClick={() => setPick(null)}>Cancel</button>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="card">
        <header className="card-head">
          <div>
            <h2>Trade-off history</h2>
            <p className="muted">One row per evolution step, starting from the MER design. Fewer units save capital but cost energy; the total annual cost shows the balance.</p>
          </div>
          {history.length > 0 && <button className="btn ghost small" onClick={() => dispatch({ type: 'evolution/clear' })}>Start again from the design</button>}
        </header>
        {history.length === 0 ? (
          <p className="muted">Apply a step to start the history; the current network is saved as the starting point.</p>
        ) : (
          <div className="table-wrap">
            <table className="grid-table data">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Change</th>
                  <th className="r">Units</th>
                  <th className="r">Hot utility<br /><span className="unit">{c.pUnit}</span></th>
                  <th className="r">Cold utility<br /><span className="unit">{c.pUnit}</span></th>
                  <th className="r">Area<br /><span className="unit">m²</span></th>
                  <th className="r">Total annual cost<br /><span className="unit">$/yr</span></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {historyRows.map(({ h, n }, i) => {
                  const current = i === historyRows.length - 1;
                  return (
                    <tr key={h.id} className={current ? 'pinch-row' : ''}>
                      <td className="muted">{i}</td>
                      <td>{h.label}</td>
                      <td className="r">{n.unitCount}</td>
                      <td className="r">{num(c.p(n.qh))}</td>
                      <td className="r">{num(c.p(n.qc))}</td>
                      <td className="r">{num(n.area)}</td>
                      <td className="r strong">{money(n.total)}</td>
                      <td className="r">
                        {current ? <span className="tag pinch">current</span> : <button className="btn ghost small" onClick={() => dispatch({ type: 'evolution/restore', index: i })}>Return here</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
