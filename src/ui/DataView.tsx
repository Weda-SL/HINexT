import type { Dispatch } from 'react';
import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import type { Action } from '../state/actions';
import { NumberField } from './NumberField';
import { conv, money, num } from './format';

interface Props {
  project: Project;
  analysis: Analysis;
  dispatch: Dispatch<Action>;
}

export function DataView({ project, analysis, dispatch }: Props) {
  const c = conv(project.settings.units);
  const resolved = new Map(analysis.streams.map((s) => [s.id, s]));
  const rUtil = new Map(analysis.utilities.map((u) => [u.id, u]));
  const targets = new Map(analysis.utilityTargets.map((t) => [t.id, t]));
  const errorRefs = new Set(analysis.issues.filter((i) => i.level === 'error' && i.ref).map((i) => i.ref));
  const half = project.settings.dtMin / 2;

  return (
    <div className="stack">
      {analysis.issues.length > 0 && (
        <section className="issues" aria-live="polite">
          {analysis.issues.map((i, k) => (
            <div key={k} className={`issue ${i.level}`}>
              <span className="issue-tag">{i.level === 'error' ? 'Error' : 'Note'}</span> {i.message}
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <header className="card-head">
          <div>
            <h2>Process streams</h2>
            <p className="muted">Hot or cold is set from the temperatures. Enter either CP or heat load; the other is calculated.</p>
          </div>
          <button className="btn primary" onClick={() => dispatch({ type: 'stream/add' })}>+ Add stream</button>
        </header>
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Type</th>
                <th className="r">T supply<br /><span className="unit">{c.tUnit}</span></th>
                <th className="r">T target<br /><span className="unit">{c.tUnit}</span></th>
                <th>Enter</th>
                <th className="r">CP<br /><span className="unit">{c.cpUnit}</span></th>
                <th className="r">Heat load<br /><span className="unit">{c.pUnit}</span></th>
                <th className="r">h<br /><span className="unit">kW/m²K</span></th>
                <th className="r">ΔT contrib.<br /><span className="unit">K</span></th>
                <th aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {project.streams.length === 0 && (
                <tr>
                  <td colSpan={11} className="empty">No streams yet. Add one, or open an example from the menu.</td>
                </tr>
              )}
              {project.streams.map((s, i) => {
                const r = resolved.get(s.id);
                const upd = (patch: Partial<typeof s>) => dispatch({ type: 'stream/update', id: s.id, patch });
                const bad = errorRefs.has(s.id);
                return (
                  <tr key={s.id} className={bad ? 'row-error' : ''}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <input
                        className="text"
                        aria-label={`Name of stream ${i + 1}`}
                        defaultValue={s.name}
                        key={s.name}
                        onBlur={(e) => e.target.value !== s.name && upd({ name: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      />
                    </td>
                    <td>{r ? <span className={`badge ${r.kind}`}>{r.kind === 'hot' ? 'Hot' : 'Cold'}</span> : <span className="badge none">—</span>}</td>
                    <td><NumberField ariaLabel="Supply temperature" value={c.t(s.tSupply)} onCommit={(v) => upd({ tSupply: c.tIn(v) })} /></td>
                    <td><NumberField ariaLabel="Target temperature" value={c.t(s.tTarget)} onCommit={(v) => upd({ tTarget: c.tIn(v) })} /></td>
                    <td>
                      <select
                        aria-label="Quantity entered"
                        value={s.spec}
                        onChange={(e) => {
                          const spec = e.target.value as 'cp' | 'duty';
                          // carry the derived value across so nothing is lost
                          upd(spec === 'duty' ? { spec, duty: r?.duty ?? s.duty } : { spec, cp: r?.cp ?? s.cp });
                        }}
                      >
                        <option value="cp">CP</option>
                        <option value="duty">Load</option>
                      </select>
                    </td>
                    <td>
                      {s.spec === 'cp' ? (
                        <NumberField ariaLabel="CP" value={c.p(s.cp ?? NaN)} onCommit={(v) => upd({ cp: c.pIn(v) })} />
                      ) : (
                        <span className="derived">{num(r ? c.p(r.cp) : NaN, 4)}</span>
                      )}
                    </td>
                    <td>
                      {s.spec === 'duty' ? (
                        <NumberField ariaLabel="Heat load" value={c.p(s.duty ?? NaN)} onCommit={(v) => upd({ duty: c.pIn(v) })} />
                      ) : (
                        <span className="derived">{num(r ? c.p(r.duty) : NaN)}</span>
                      )}
                    </td>
                    <td><NumberField ariaLabel="Film coefficient" value={s.h} onCommit={(v) => upd({ h: Number.isNaN(v) ? undefined : v })} placeholder="—" /></td>
                    <td><NumberField ariaLabel="ΔT contribution" value={s.dtCont ?? undefined} onCommit={(v) => upd({ dtCont: Number.isNaN(v) ? null : v })} placeholder={num(half)} /></td>
                    <td className="row-actions">
                      <button className="icon" title="Duplicate" aria-label={`Duplicate ${s.name}`} onClick={() => dispatch({ type: 'stream/duplicate', id: s.id })}>⧉</button>
                      <button className="icon danger" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => dispatch({ type: 'stream/delete', id: s.id })}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hint">Blank ΔT contribution uses ΔTmin/2 ({num(half)} K). Film coefficients are only needed for area and capital targets.</p>
      </section>

      <section className="card">
        <header className="card-head">
          <div>
            <h2>Utilities</h2>
            <p className="muted">Equal supply and target temperatures mean an isothermal utility (e.g. condensing steam). Duties are placed against the grand composite curve: coldest hot utility and warmest cold utility first.</p>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => dispatch({ type: 'utility/add', kind: 'hot' })}>+ Hot utility</button>
            <button className="btn" onClick={() => dispatch({ type: 'utility/add', kind: 'cold' })}>+ Cold utility</button>
          </div>
        </header>
        <div className="table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th className="r">T supply<br /><span className="unit">{c.tUnit}</span></th>
                <th className="r">T target<br /><span className="unit">{c.tUnit}</span></th>
                <th className="r">Cost<br /><span className="unit">$/kW·yr</span></th>
                <th className="r">h<br /><span className="unit">kW/m²K</span></th>
                <th className="r">ΔT contrib.<br /><span className="unit">K</span></th>
                <th className="r">Target duty<br /><span className="unit">{c.pUnit}</span></th>
                <th className="r">Cost<br /><span className="unit">$/yr</span></th>
                <th aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {project.utilities.length === 0 && (
                <tr><td colSpan={10} className="empty">No utilities. Energy targets still work; costs need utilities.</td></tr>
              )}
              {project.utilities.map((u) => {
                const upd = (patch: Partial<typeof u>) => dispatch({ type: 'utility/update', id: u.id, patch });
                const t = targets.get(u.id);
                const ok = rUtil.has(u.id);
                return (
                  <tr key={u.id} className={errorRefs.has(u.id) ? 'row-error' : ''}>
                    <td>
                      <input className="text" aria-label="Utility name" defaultValue={u.name} key={u.name}
                        onBlur={(e) => e.target.value !== u.name && upd({ name: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                    </td>
                    <td>
                      <select aria-label="Utility type" value={u.kind} onChange={(e) => upd({ kind: e.target.value as 'hot' | 'cold', tSupply: u.tTarget, tTarget: u.tSupply })}>
                        <option value="hot">Hot</option>
                        <option value="cold">Cold</option>
                      </select>
                    </td>
                    <td><NumberField ariaLabel="Supply temperature" value={c.t(u.tSupply)} onCommit={(v) => upd({ tSupply: c.tIn(v) })} /></td>
                    <td><NumberField ariaLabel="Target temperature" value={c.t(u.tTarget)} onCommit={(v) => upd({ tTarget: c.tIn(v) })} /></td>
                    <td><NumberField ariaLabel="Cost" value={u.cost} onCommit={(v) => upd({ cost: v })} /></td>
                    <td><NumberField ariaLabel="Film coefficient" value={u.h} onCommit={(v) => upd({ h: Number.isNaN(v) ? undefined : v })} placeholder="—" /></td>
                    <td><NumberField ariaLabel="ΔT contribution" value={u.dtCont ?? undefined} onCommit={(v) => upd({ dtCont: Number.isNaN(v) ? null : v })} placeholder={num(half)} /></td>
                    <td className="r strong">{ok ? num(c.p(t?.duty ?? 0)) : '—'}</td>
                    <td className="r">{ok ? money(t?.opCost ?? 0) : '—'}</td>
                    <td className="row-actions">
                      <button className="icon danger" title="Delete" aria-label={`Delete ${u.name}`} onClick={() => dispatch({ type: 'utility/delete', id: u.id })}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
