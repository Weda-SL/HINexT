import type { Dispatch } from 'react';
import type { Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import { PINCH_X, splitOf, type NetworkResult, type Region } from '../core/network';
import type { Action } from '../state/actions';
import { NumberField } from './NumberField';
import { streamSpan } from './GridDiagram';
import { conv, num } from './format';

interface Props {
  project: Project;
  analysis: Analysis;
  net: NetworkResult;
  streamId: string;
  dispatch: Dispatch<Action>;
}

/**
 * Split a stream into parallel branches over one side of the pinch. Each branch
 * is given as its CP (or, for a non-linear stream, its share of the flow); the
 * other branches take up the difference in proportion.
 */
export function SplitEditor({ project, analysis, net, streamId, dispatch }: Props) {
  const c = conv(project.settings.units);
  const s = analysis.streams.find((x) => x.id === streamId);
  if (!s) return null;
  const pinch = analysis.pt.pinches[0];
  const hasPinch = pinch !== undefined;
  const [a, b] = streamSpan(s, pinch);
  const sides: Region[] = !hasPinch ? ['above'] : (['above', 'below'] as const).filter((r) => (r === 'above' ? a < PINCH_X - 1e-9 : b > PINCH_X + 1e-9));
  const byCp = !s.nonlinear && Number.isFinite(s.cp) && s.cp > 0;
  const sr = net.streams.get(s.id);

  const set = (side: Region, fractions: number[] | null, label: string) => dispatch({ type: 'split/set', stream: s.id, side, fractions, label });

  const sideBlock = (side: Region) => {
    const sp = splitOf(project, s.id, side);
    const title = !hasPinch ? 'Whole stream' : side === 'above' ? 'Above the pinch' : 'Below the pinch';
    const dutySide = sr ? (side === 'above' ? sr.remainingAbove : sr.remainingBelow) : 0;
    if (!sp || sp.fractions.length < 2) {
      return (
        <div className="split-side" key={side}>
          <h4>{title}</h4>
          <p className="muted small">Not split.</p>
          <button className="btn small" onClick={() => set(side, [0.5, 0.5], `Split ${s.name} ${side} the pinch`)}>
            Split in two
          </button>
        </div>
      );
    }
    const f = normalise(sp.fractions);
    const br = sr?.branches?.[side];
    const edit = (k: number, share: number) => {
      if (!(share > 0 && share < 1)) return;
      const restOld = 1 - f[k];
      const next = f.map((x, i) => (i === k ? share : restOld > 0 ? (x / restOld) * (1 - share) : (1 - share) / (f.length - 1)));
      set(side, next, `Change branch ${k + 1} of ${s.name}`);
    };
    return (
      <div className="split-side" key={side}>
        <h4>{title}</h4>
        <table className="split-table">
          <thead>
            <tr>
              <th>Branch</th>
              <th className="r">{byCp ? `CP, ${c.cpUnit}` : 'Share of flow, %'}</th>
              <th className="r">Unmatched, {c.pUnit}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {f.map((x, k) => (
              <tr key={k}>
                <td>{k + 1}</td>
                <td className="r">
                  <NumberField
                    ariaLabel={`Branch ${k + 1} ${byCp ? 'CP' : 'share'}`}
                    value={byCp ? c.p(s.cp * x) : x * 100}
                    onCommit={(v) => edit(k, byCp ? c.pIn(v) / s.cp : v / 100)}
                  />
                </td>
                <td className="r">{br ? num(c.p(br[k].remaining)) : '—'}</td>
                <td className="r">
                  <button
                    className="icon"
                    title={f.length > 2 ? 'Remove this branch' : 'Remove the split'}
                    aria-label={f.length > 2 ? `Remove branch ${k + 1}` : 'Remove the split'}
                    onClick={() => (f.length > 2 ? set(side, normalise(f.filter((_, i) => i !== k)), `Remove branch ${k + 1} of ${s.name}`) : set(side, null, `Remove split of ${s.name}`))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="btn-row">
          <button
            className="btn small"
            onClick={() => {
              // split the largest branch in half
              const k = f.indexOf(Math.max(...f));
              const next = f.flatMap((x, i) => (i === k ? [x / 2, x / 2] : [x]));
              set(side, next, `Add a branch to ${s.name}`);
            }}
          >
            + Branch
          </button>
          <button className="btn ghost small" onClick={() => set(side, null, `Remove split of ${s.name}`)}>
            Remove split
          </button>
        </div>
        {dutySide < -1e-6 && <p className="hint warn">This side is over-satisfied.</p>}
      </div>
    );
  };

  return (
    <div className="unit-panel split-panel" data-keep-section>
      <h3>Split {s.name}</h3>
      <p className="muted small">
        Branches run in parallel over one side of the pinch and mix again at its end. {byCp ? 'Set each branch’s CP; the other branches share the rest.' : 'Set each branch’s share of the flow.'} Click a branch line on the grid to match it.
      </p>
      <div className="split-sides">{sides.map(sideBlock)}</div>
    </div>
  );
}

function normalise(f: number[]): number[] {
  const t = f.reduce((a, b) => a + b, 0);
  return t > 0 ? f.map((x) => x / t) : f;
}

