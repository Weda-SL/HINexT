import type { ProblemTable } from '../core/cascade';
import type { Conv } from './format';
import { num } from './format';

// Explicit colours so the SVG reads the same when exported.
const INK = '#0b0b0b';
const INK2 = '#52514e';
const RULE = '#b5b3ad';
const NEG = '#b42318';
const PINCH = '#4b3cc0';
const FONT = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

/**
 * Classic heat cascade diagram: interval boxes with ΔH, dashed boundary lines
 * labelled with the shifted temperature, and the heat flow at each boundary —
 * left column with zero hot utility, right column with QH,min added.
 */
export function CascadeDiagram({ pt, c }: { pt: ProblemTable; c: Conv }) {
  const n = pt.boundaries.length;
  if (n < 2) return null;
  const rowH = 74;
  const top = 64;
  const H = top + (n - 1) * rowH + 70;
  const W = 640;
  const colX = [250, 500]; // centres of the two cascades
  const tempX = 18;
  const boxW = 112;
  const boxH = 30;
  const latent = new Map(pt.latent.map((l) => [l.t, l.hot - l.cold]));
  const pinch = new Set(pt.pinches);
  const y = (i: number) => top + i * rowH;
  const flows = [pt.infeasible, pt.feasible];
  // flow entering the top of each column
  const startFlow = [0, pt.qhMin];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Heat cascade diagram" fontFamily={FONT} className="cascade-svg">
      <defs>
        <marker id="cas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L10 5L0 10z" fill={INK} />
        </marker>
      </defs>
      {['Zero hot utility', 'With QH,min'].map((label, k) => (
        <text key={label} x={colX[k]} y={18} fontSize="12" fontWeight="600" fill={INK2} textAnchor="middle">{label}</text>
      ))}
      {colX.map((x, k) => (
        <g key={`u${k}`}>
          <Pill x={x} y={31} text={k === 1 ? `QH,min = ${num(c.p(startFlow[k]))} ${c.pUnit}` : `Hot utility ${num(c.p(startFlow[k]))} ${c.pUnit}`} bg="#fff0e8" fg="#a8461c" />
          <line x1={x} x2={x} y1={42} y2={y(0) - 2} stroke={INK} strokeWidth="1.4" markerEnd="url(#cas-arrow)" />
        </g>
      ))}

      {pt.boundaries.map((t, i) => {
        const yy = y(i);
        const isPinch = pinch.has(t);
        const lat = latent.get(t);
        return (
          <g key={`b${i}`}>
            <line x1={tempX + 70} x2={W - 8} y1={yy} y2={yy} stroke={isPinch ? PINCH : RULE} strokeDasharray="6 5" strokeWidth={isPinch ? 1.6 : 1} />
            <text x={tempX} y={yy + 4} fontSize="12" fill={INK}>{num(c.t(t))} {c.tUnit}</text>
            {isPinch && <text x={tempX} y={yy + 18} fontSize="11" fontWeight="600" fill={PINCH}>pinch</text>}
            {lat !== undefined && Math.abs(lat) > 1e-9 && (
              <text x={tempX} y={yy - 7} fontSize="10.5" fill={INK2}>{lat > 0 ? '+' : '−'}{num(c.p(Math.abs(lat)))} latent</text>
            )}
            {flows.map((f, k) => (
              <text key={k} x={colX[k] + boxW / 2 + 8} y={yy - 5} fontSize="12" fontWeight={isPinch && k === 1 ? 700 : 500} fill={f[i] < -1e-9 ? NEG : isPinch && k === 1 ? PINCH : INK}>
                {num(c.p(f[i]))} {c.pUnit}
              </text>
            ))}
          </g>
        );
      })}

      {pt.intervals.map((iv, i) => {
        const cy = (y(i) + y(i + 1)) / 2;
        return colX.map((x, k) => (
          <g key={`i${i}-${k}`}>
            <line x1={x} x2={x} y1={y(i)} y2={cy - boxH / 2 - 2} stroke={INK} strokeWidth="1.4" markerEnd="url(#cas-arrow)" />
            <rect x={x - boxW / 2} y={cy - boxH / 2} width={boxW} height={boxH} fill="#fff" stroke={INK} strokeWidth="1" />
            <text x={x} y={cy + 4} fontSize="12.5" textAnchor="middle" fill={INK}>
              <tspan fontStyle="italic">ΔH</tspan> = {num(c.p(iv.dH))}
            </text>
            <line x1={x} x2={x} y1={cy + boxH / 2} y2={y(i + 1) - 2} stroke={INK} strokeWidth="1.4" markerEnd="url(#cas-arrow)" />
          </g>
        ));
      })}

      {colX.map((x, k) => (
        <g key={`c${k}`}>
          <line x1={x} x2={x} y1={y(n - 1)} y2={y(n - 1) + 30} stroke={INK} strokeWidth="2.2" markerEnd="url(#cas-arrow)" />
          <Pill x={x} y={y(n - 1) + 46} text={k === 1 ? `QC,min = ${num(c.p(flows[k][n - 1]))} ${c.pUnit}` : `Cold utility ${num(c.p(flows[k][n - 1]))} ${c.pUnit}`} bg="#e5f6ef" fg="#12734f" />
        </g>
      ))}
    </svg>
  );
}

/** Rounded "pill" tag centred on (x, y), matching the tags used in the tables. */
function Pill({ x, y, text, bg, fg }: { x: number; y: number; text: string; bg: string; fg: string }) {
  const w = text.length * 6.6 + 18;
  return (
    <g>
      <rect x={x - w / 2} y={y - 10} width={w} height={20} rx={10} fill={bg} />
      <text x={x} y={y + 4} fontSize="12" fontWeight="600" fill={fg} textAnchor="middle">{text}</text>
    </g>
  );
}
