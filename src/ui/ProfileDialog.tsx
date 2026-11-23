import { useEffect, useMemo, useRef, useState } from 'react';
import type { NonLinearProfile, ProfileSegment, Stream } from '../core/types';
import { resolveStreams } from '../core/streams';
import { NumberField } from './NumberField';
import { conv, num, type DisplayUnits } from './format';

interface Props {
  stream: Stream;
  units: DisplayUnits;
  dtMin: number;
  onApply: (data: NonLinearProfile, h: number | undefined) => void;
  onCancel: () => void;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function initial(stream: Stream): NonLinearProfile {
  if (stream.profileData && stream.profileData.temps.length >= 2) return structuredClone(stream.profileData);
  const temps = [stream.tSupply, stream.tTarget];
  const seg: ProfileSegment =
    stream.spec === 'duty' ? { spec: 'duty', duty: stream.duty, h: stream.h } : { spec: 'cp', cp: stream.cp, h: stream.h };
  return { temps, segments: [seg], hConstant: true };
}

/**
 * Dialog for a non-linear temperature–enthalpy profile: a list of temperature
 * points with the CP or heat load of each segment between them. Two equal
 * consecutive temperatures make a phase-change segment (heat load only).
 */
export function ProfileDialog({ stream, units, dtMin, onApply, onCancel }: Props) {
  const c = conv(units);
  const [data, setData] = useState<NonLinearProfile>(() => initial(stream));
  const [h, setH] = useState<number | undefined>(stream.h);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    box.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Validate with the same code the analysis uses.
  const check = useMemo(() => {
    const trial: Stream = { ...stream, h, profile: 'nonlinear', profileData: data };
    return resolveStreams([trial], dtMin);
  }, [stream, data, h, dtMin]);
  const resolved = check.resolved[0];
  const errors = check.issues.map((i) => i.message.replace(`${stream.name || 'Unnamed stream'}: `, ''));

  const setTemp = (k: number, v: number) => setData((d) => ({ ...d, temps: d.temps.map((t, i) => (i === k ? v : t)) }));
  const setSeg = (k: number, patch: Partial<ProfileSegment>) =>
    setData((d) => ({ ...d, segments: d.segments.map((s, i) => (i === k ? { ...s, ...patch } : s)) }));
  const addPoint = () =>
    setData((d) => {
      const last = d.segments[d.segments.length - 1];
      return { ...d, temps: [...d.temps, NaN], segments: [...d.segments, { spec: last?.spec ?? 'cp', h: last?.h }] };
    });
  const removePoint = (k: number) =>
    setData((d) => {
      if (d.temps.length <= 2) return d;
      const segIdx = k === d.temps.length - 1 ? k - 1 : k;
      return { ...d, temps: d.temps.filter((_, i) => i !== k), segments: d.segments.filter((_, i) => i !== segIdx) };
    });

  const rows: React.ReactNode[] = [];
  data.temps.forEach((t, k) => {
    rows.push(
      <tr key={`p${k}`} className="pt-row">
        <td className="muted">T{k + 1}</td>
        <td>
          <NumberField ariaLabel={`Temperature point ${k + 1}`} value={c.t(t)} onCommit={(v) => setTemp(k, c.tIn(v))} />
        </td>
        <td colSpan={3} />
        <td className="row-actions">
          {k === data.temps.length - 1 && (
            <>
              <button className="icon" title="Add a point after this one" aria-label="Add a point" onClick={addPoint}>+</button>
              <button className="icon danger" title="Remove the last point" aria-label="Remove the last point" disabled={data.temps.length <= 2} onClick={() => removePoint(k)}>×</button>
            </>
          )}
        </td>
      </tr>,
    );
    if (k < data.segments.length) {
      const seg = data.segments[k];
      const a = t;
      const b = data.temps[k + 1];
      const dT = finite(a) && finite(b) ? Math.abs(b - a) : NaN;
      const phase = finite(dT) && dT < 1e-7;
      const cp = phase ? NaN : seg.spec === 'cp' ? seg.cp : finite(seg.duty) && dT > 0 ? seg.duty / dT : NaN;
      const duty = seg.spec === 'duty' || phase ? seg.duty : finite(seg.cp) && finite(dT) ? seg.cp * dT : NaN;
      rows.push(
        <tr key={`s${k}`} className="seg-row">
          <td />
          <td className="seg-label">
            {phase ? <span className="tag pinch">phase change</span> : null}
          </td>
          <td>
            {phase ? (
              <span className="derived" title="Infinite CP: all the heat is exchanged at one temperature">∞</span>
            ) : (
              <NumberField
                ariaLabel={`CP of segment ${k + 1}`}
                className={seg.spec === 'cp' ? '' : 'calc'}
                value={c.p(cp ?? NaN)}
                dp={4}
                onCommit={(v) => setSeg(k, { spec: 'cp', cp: c.pIn(v) })}
              />
            )}
          </td>
          <td>
            <NumberField
              ariaLabel={`Heat load of segment ${k + 1}`}
              className={seg.spec === 'duty' || phase ? '' : 'calc'}
              value={c.p(duty ?? NaN)}
              dp={3}
              onCommit={(v) => setSeg(k, { spec: 'duty', duty: c.pIn(v) })}
            />
          </td>
          <td>
            {data.hConstant ? (
              <span className="derived">{num(h)}</span>
            ) : (
              <NumberField ariaLabel={`Film coefficient of segment ${k + 1}`} value={seg.h} placeholder="—" onCommit={(v) => setSeg(k, { h: Number.isNaN(v) ? undefined : v })} />
            )}
          </td>
          <td />
        </tr>,
      );
    }
  });

  const lo = Math.min(stream.tSupply, stream.tTarget);
  const hi = Math.max(stream.tSupply, stream.tTarget);
  const rangeKnown = finite(lo) && finite(hi);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" ref={box}>
        <header className="modal-head">
          <div>
            <h2 id="profile-title">Non-linear profile — {stream.name || 'Unnamed stream'}</h2>
            <p className="muted">
              {rangeKnown ? (
                <>Supply → target from the main table: <b>{num(c.t(stream.tSupply))} → {num(c.t(stream.tTarget))} {c.tUnit}</b>. </>
              ) : (
                <>Enter the supply and target temperatures in the main table. </>
              )}
              The profile may extend beyond them; only the part in between is used. Repeat a temperature to add a phase change (enter its heat load).
            </p>
          </div>
          <button className="icon" aria-label="Close" onClick={onCancel}>×</button>
        </header>

        <label className="check">
          <input type="checkbox" checked={data.hConstant} onChange={(e) => setData((d) => ({ ...d, hConstant: e.target.checked }))} />
          Same film coefficient for every segment
          {data.hConstant && (
            <span className="inline-field">
              h <NumberField ariaLabel="Film coefficient for all segments" value={h} placeholder="—" onCommit={(v) => setH(Number.isNaN(v) ? undefined : v)} /> kW/m²K
            </span>
          )}
        </label>

        <div className="table-wrap modal-table">
          <table className="grid-table profile-table">
            <thead>
              <tr>
                <th />
                <th className="r">Temperature<br /><span className="unit">{c.tUnit}</span></th>
                <th className="r">CP<br /><span className="unit">{c.cpUnit}</span></th>
                <th className="r">Heat load<br /><span className="unit">{c.pUnit}</span></th>
                <th className="r">h<br /><span className="unit">kW/m²K</span></th>
                <th aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>

        <div className={`modal-status ${errors.length ? 'bad' : 'good'}`}>
          {errors.length ? (
            errors.map((e, i) => <div key={i}>{e}</div>)
          ) : resolved ? (
            <div>
              {resolved.kind === 'hot' ? 'Hot' : 'Cold'} stream · heat load between supply and target <b>{num(c.p(resolved.duty))} {c.pUnit}</b>
              {resolved.pieces.some((p) => p.iso) ? ' · includes phase change' : ''}
            </div>
          ) : null}
        </div>

        <footer className="modal-foot">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={() => onApply(data, h)}>Apply</button>
        </footer>
      </div>
    </div>
  );
}
