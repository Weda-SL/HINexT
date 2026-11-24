import { useState, type Dispatch } from 'react';
import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import type { Action } from '../state/actions';
import { NumberField } from './NumberField';
import { conv, money, num } from './format';
import { HeadlineTargets } from './HeadlineTargets';
import { ProfileDialog } from './ProfileDialog';
import { CurvesView } from './CurvesView';
import { ProblemTableView } from './ProblemTableView';

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
  const [editing, setEditing] = useState<string | null>(null);
  const editingStream = project.streams.find((s) => s.id === editing);

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
            <p className="muted">Hot or cold is set from the temperatures. Type either CP or heat load and the other is calculated (shown in grey). If you then change a temperature, the value you typed is kept and the other is recalculated.</p>
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
                <th>Profile</th>
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
                  <td colSpan={11} className="empty">No streams yet. Add one, or choose an example from the Open menu.</td>
                </tr>
              )}
              {project.streams.map((s, i) => {
                const r = resolved.get(s.id);
                const upd = (patch: Partial<typeof s>) => dispatch({ type: 'stream/update', id: s.id, patch });
                const bad = errorRefs.has(s.id);
                const nl = s.profile === 'nonlinear';
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
                      <div className="profile-cell">
                        <select
                          className="profile-select"
                          aria-label="Temperature–enthalpy profile"
                          value={nl ? 'nonlinear' : 'linear'}
                          onChange={(e) => {
                            if (e.target.value === 'nonlinear') setEditing(s.id);
                            else dispatch({ type: 'stream/setProfile', id: s.id, profile: 'linear' });
                          }}
                        >
                          <option value="linear">Linear</option>
                          <option value="nonlinear">Non-linear</option>
                        </select>
                        {nl && <button className="btn ghost small" onClick={() => setEditing(s.id)}>Edit…</button>}
                      </div>
                    </td>
                    {nl ? (
                      <>
                        <td><span className="derived" title="CP changes along this stream; edit it in the profile">varies</span></td>
                        <td><span className="derived">{num(r ? c.p(r.duty) : NaN)}</span></td>
                      </>
                    ) : (
                      <>
                        <td>
                      <NumberField
                        ariaLabel="CP"
                        className={s.spec === 'cp' ? '' : 'calc'}
                        value={c.p(s.spec === 'cp' ? (s.cp ?? NaN) : (r?.cp ?? NaN))}
                        dp={4}
                        onCommit={(v) => upd({ spec: 'cp', cp: c.pIn(v) })}
                      />
                    </td>
                        <td>
                      <NumberField
                        ariaLabel="Heat load"
                        className={s.spec === 'duty' ? '' : 'calc'}
                        value={c.p(s.spec === 'duty' ? (s.duty ?? NaN) : (r?.duty ?? NaN))}
                        dp={3}
                        onCommit={(v) => upd({ spec: 'duty', duty: c.pIn(v) })}
                      />
                    </td>
                      </>
                    )}
                    <td>
                      {nl && !s.profileData?.hConstant ? (
                        <span className="derived" title="Set per segment in the profile">per segment</span>
                      ) : (
                        <NumberField ariaLabel="Film coefficient" value={s.h} onCommit={(v) => upd({ h: Number.isNaN(v) ? undefined : v })} placeholder="—" />
                      )}
                    </td>
                    <td><DtCell value={s.dtCont} half={half} name={s.name} onChange={(dtCont) => upd({ dtCont })} /></td>
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
        <p className="hint">ΔT contribution: grey values are the default, ΔTmin/2 ({num(half)} K). Type a value to override it for one stream (e.g. a larger value for a gas or a fouling stream, a smaller one for a boiling or condensing stream); ↺ restores the default. Film coefficients are only needed for area and capital targets.</p>
      </section>

      {analysis.streams.length > 0 && <CurvesView project={project} analysis={analysis} which="composites" />}
      {analysis.streams.length > 0 && <ProblemTableView project={project} analysis={analysis} part="table" />}
      {analysis.streams.length > 0 && <ProblemTableView project={project} analysis={analysis} part="cascade" />}
      {analysis.streams.length > 0 && <CurvesView project={project} analysis={analysis} which="gcc" />}

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
                    <td><DtCell value={u.dtCont} half={half} name={u.name} onChange={(dtCont) => upd({ dtCont })} /></td>
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

      {editingStream && (
        <ProfileDialog
          stream={editingStream}
          units={project.settings.units}
          dtMin={project.settings.dtMin}
          onCancel={() => setEditing(null)}
          onApply={(data, h) => {
            dispatch({ type: 'stream/setProfile', id: editingStream.id, profile: 'nonlinear', data, h: h ?? NaN });
            setEditing(null);
          }}
        />
      )}
      <HeadlineTargets project={project} analysis={analysis} />
    </div>
  );
}

/** ΔT contribution cell: shows the default (ΔTmin/2) until the user overrides it. */
function DtCell({ value, half, name, onChange }: { value: number | null | undefined; half: number; name: string; onChange: (v: number | null) => void }) {
  const overridden = typeof value === 'number' && Number.isFinite(value);
  return (
    <div className={`dtc ${overridden ? 'set' : ''}`}>
      <NumberField
        ariaLabel={`ΔT contribution of ${name}${overridden ? '' : ' (default)'}`}
        value={overridden ? value : undefined}
        placeholder={num(half)}
        onCommit={(v) => onChange(Number.isNaN(v) || v < 0 ? null : v)}
      />
      {overridden ? (
        <button className="icon reset" title={`Reset to default (${num(half)} K)`} aria-label={`Reset ΔT contribution of ${name} to default`} onClick={() => onChange(null)}>↺</button>
      ) : (
        <span className="reset-space" aria-hidden="true" />
      )}
    </div>
  );
}
