import { useEffect, useRef, useState } from 'react';
import type { NetUnit, Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import { PINCH_X, type NetworkResult } from '../core/network';
import type { ResolvedStream } from '../core/streams';
import { conv, num } from './format';
import { DownloadMenu, saveSvgFile, saveSvgPdf, saveSvgPng } from './svgExport';
import { safeFileName } from '../state/storage';

const INK = '#0b0b0b';
const INK2 = '#52514e';
const INK3 = '#8a8883';
const HOT = '#e34948';
const COLD = '#2a78d6';
const PINCH = '#4b3cc0';
const ERR = '#b42318';
const WARN = '#c27a00';
const HEATER = '#eb6834';
const COOLER = '#1baf7a';
const FONT = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

export interface Highlight {
  /** unit id → sign of the load shift (+1 / −1), drawn as + / − badges */
  units: Map<string, 1 | -1>;
  color: string;
}

interface Props {
  project: Project;
  analysis: Analysis;
  net: NetworkResult;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Create a match between two streams at position x (undefined = read-only) */
  onMatch?: (hot: string, cold: string, x: number) => void;
  onMove?: (id: string, x: number) => void;
  onAddUtility?: (stream: string) => void;
  highlight?: Highlight;
  /** Show the remaining-duty buttons at the stream ends */
  editable?: boolean;
}

/** Horizontal extent (0…1) of a stream on the grid, given which side of the pinch it exists on. */
export function streamSpan(s: ResolvedStream, pinch: number | undefined): [number, number] {
  if (pinch === undefined) return [0, 1];
  if (s.kind === 'hot') {
    const pT = pinch + s.dtc;
    const start = s.ts <= pT + 1e-9 ? PINCH_X : 0;
    const end = s.tt >= pT - 1e-9 ? PINCH_X : 1;
    return [start, end];
  }
  const pT = pinch - s.dtc;
  const left = s.tt <= pT + 1e-9 ? PINCH_X : 0; // target end (hot side) on the left
  const right = s.ts >= pT - 1e-9 ? PINCH_X : 1;
  return [left, right];
}

export function GridDiagram({ project, analysis, net, selected, onSelect, onMatch, onMove, onAddUtility, highlight, editable }: Props) {
  const c = conv(project.settings.units);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pending, setPending] = useState<{ stream: string; x: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number } | null>(null);
  const units = project.network?.units ?? [];
  const pinch = analysis.pt.pinches[0];
  const hots = analysis.streams.filter((s) => s.kind === 'hot');
  const colds = analysis.streams.filter((s) => s.kind === 'cold');
  const rows = [...hots, ...colds];
  const rowOf = new Map(rows.map((s, i) => [s.id, i]));
  const byId = new Map(rows.map((s) => [s.id, s]));
  const res = new Map(net.units.map((r) => [r.id, r]));
  const issueLevel = new Map<string, 'error' | 'warning'>();
  for (const i of net.issues) if (i.unit && issueLevel.get(i.unit) !== 'error') issueLevel.set(i.unit, i.level);

  const W = 1100;
  const L = 190;
  const R = 150;
  const top = 58;
  const rowH = 54;
  const gap = hots.length && colds.length ? 22 : 0;
  const yRow = (i: number) => top + i * rowH + (i >= hots.length ? gap : 0);
  const H = yRow(Math.max(0, rows.length - 1)) + 70;
  const px = (x: number) => L + x * (W - L - R);
  const ix = (p: number) => Math.min(0.98, Math.max(0.02, (p - L) / (W - L - R)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPending(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  };

  const clickStream = (s: ResolvedStream, e: React.MouseEvent) => {
    if (!onMatch) return;
    e.stopPropagation();
    const x = ix(toLocal(e));
    if (!pending) {
      setPending({ stream: s.id, x });
      return;
    }
    if (pending.stream === s.id) {
      setPending(null);
      return;
    }
    const first = byId.get(pending.stream)!;
    if (first.kind === s.kind) {
      setPending({ stream: s.id, x });
      return;
    }
    const hot = first.kind === 'hot' ? first.id : s.id;
    const cold = first.kind === 'cold' ? first.id : s.id;
    onMatch(hot, cold, pending.x);
    setPending(null);
  };

  const unitX = (u: NetUnit) => (drag?.id === u.id ? drag.x : u.x);

  const startDrag = (u: NetUnit, e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect(u.id);
    if (!onMove) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: u.id, x: u.x });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ id: drag.id, x: ix(toLocal(e)) });
  };
  const endDrag = () => {
    if (!drag) return;
    const u = units.find((v) => v.id === drag.id);
    if (u && Math.abs(u.x - drag.x) > 1e-4) onMove?.(drag.id, +drag.x.toFixed(4));
    setDrag(null);
  };

  const filename = `${safeFileName(project.name)}_grid_diagram`;

  return (
    <figure className="chart grid-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Heat exchanger network grid diagram"
        fontFamily={FONT}
        className="grid-svg"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClick={() => {
          setPending(null);
          onSelect(null);
        }}
      >
        <rect x="0" y="0" width={W} height={H} fill="#ffffff" />
        <defs>
          {(['hot', 'cold'] as const).map((k) => (
            <marker key={k} id={`grid-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L10 5L0 10z" fill={k === 'hot' ? HOT : COLD} />
            </marker>
          ))}
        </defs>

        {/* header */}
        <text x={L - 10} y={26} fontSize="11.5" fill={INK2} textAnchor="end">Stream · CP ({c.cpUnit})</text>
        {pinch !== undefined && (
          <g>
            <line x1={px(PINCH_X)} x2={px(PINCH_X)} y1={34} y2={H - 26} stroke={PINCH} strokeWidth="1.6" strokeDasharray="7 5" />
            <text x={px(PINCH_X)} y={26} fontSize="12" fontWeight="700" fill={PINCH} textAnchor="middle">Pinch</text>
            <text x={px(PINCH_X) - 8} y={H - 10} fontSize="11" fill={PINCH} textAnchor="end">
              hot {num(c.t(pinch + analysis.dtMin / 2))} {c.tUnit}
            </text>
            <text x={px(PINCH_X) + 8} y={H - 10} fontSize="11" fill={PINCH}>
              cold {num(c.t(pinch - analysis.dtMin / 2))} {c.tUnit}
            </text>
            <text x={px(0.25)} y={44} fontSize="11" fill={INK3} textAnchor="middle">above the pinch</text>
            <text x={px(0.75)} y={44} fontSize="11" fill={INK3} textAnchor="middle">below the pinch</text>
          </g>
        )}

        {/* streams */}
        {rows.map((s) => {
          const i = rowOf.get(s.id)!;
          const y = yRow(i);
          const [a, b] = streamSpan(s, pinch);
          const color = s.kind === 'hot' ? HOT : COLD;
          const sr = net.streams.get(s.id);
          const isPending = pending?.stream === s.id;
          const canPair = pending && byId.get(pending.stream)!.kind !== s.kind;
          const x1 = px(a);
          const x2 = px(b);
                  const remaining = sr ? sr.remaining : s.duty;
          return (
            <g key={s.id}>
              {(() => {
                const cpText = s.nonlinear ? 'varies' : num(c.p(s.cp));
                const pw = Math.max(26, cpText.length * 6.6 + 14);
                const right = L - 10;
                return (
                  <>
                    <text x={right - pw - 8} y={y + 4} fontSize="12.5" fontWeight="600" fill={color} textAnchor="end">
                      {s.name}
                    </text>
                    <rect x={right - pw} y={y - 9} width={pw} height={18} rx={9} fill={s.kind === 'hot' ? '#fdecec' : '#e8f1fc'} />
                    <text x={right - pw / 2} y={y + 4} fontSize="11" fontWeight="600" fill={s.kind === 'hot' ? '#a32625' : '#1d5aa6'} textAnchor="middle">
                      {cpText}
                    </text>
                  </>
                );
              })()}
              <line
                x1={s.kind === 'hot' ? x1 : x2}
                x2={s.kind === 'hot' ? x2 - 4 : x1 + 4}
                y1={y}
                y2={y}
                stroke={color}
                strokeWidth={isPending ? 5 : 3}
                markerEnd={`url(#grid-${s.kind})`}
              />
              {/* supply / target temperatures */}
              {s.kind === 'hot' ? (
                <>
                  <text x={x1 - 2} y={y - 8} fontSize="10.5" fill={INK2}>{num(c.t(s.ts))}°</text>
                  <text x={x2 + 6} y={y + 4} fontSize="10.5" fill={INK2}>{num(c.t(s.tt))}°</text>
                </>
              ) : (
                <>
                  <text x={x2 + 6} y={y + 4} fontSize="10.5" fill={INK2}>{num(c.t(s.ts))}°</text>
                  <text x={x1 + 2} y={y - 8} fontSize="10.5" fill={INK2}>{num(c.t(s.tt))}°</text>
                </>
              )}
              {/* click target */}
              {onMatch && (
                <rect
                  x={x1}
                  y={y - 14}
                  width={Math.max(4, x2 - x1)}
                  height={28}
                  fill={isPending ? 'rgba(75,60,192,0.08)' : canPair ? 'rgba(42,120,214,0.05)' : 'transparent'}
                  style={{ cursor: 'crosshair' }}
                  onClick={(e) => clickStream(s, e)}
                  data-hover="1"
                />
              )}
              {isPending && (
                <circle cx={px(pending.x)} cy={y} r={9} fill="none" stroke={PINCH} strokeWidth="2" strokeDasharray="3 2" data-hover="1" />
              )}
              {/* remaining duty at the stream end */}
              {sr && Math.abs(remaining) > 1e-6 && (
                <g
                  transform={`translate(${W - R + 22}, ${y})`}
                  style={{ cursor: editable && onAddUtility && remaining > 0 ? 'pointer' : 'default' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (editable && remaining > 0) onAddUtility?.(s.id);
                  }}
                >
                  <rect x={0} y={-10} width={118} height={20} rx={10} fill={remaining > 0 ? (s.kind === 'hot' ? '#e5f6ef' : '#fff0e8') : '#fdecea'} />
                  <text x={59} y={4} fontSize="11" fontWeight="600" textAnchor="middle" fill={remaining > 0 ? (s.kind === 'hot' ? '#12734f' : '#a8461c') : ERR}>
                    {remaining > 0
                      ? `${editable ? '+ ' : ''}${s.kind === 'hot' ? 'cool' : 'heat'} ${num(c.p(remaining))}`
                      : `over by ${num(c.p(-remaining))}`}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* units */}
        {units.map((u) => {
          const r = res.get(u.id);
          const x = px(unitX(u));
          const lvl = issueLevel.get(u.id);
          const sel = selected === u.id;
          const stroke = lvl === 'error' ? ERR : lvl === 'warning' ? WARN : INK;
          const hl = highlight?.units.get(u.id);
          const ring = hl !== undefined ? highlight!.color : sel ? PINCH : null;
          const circle = (cy: number, fill: string, label?: string) => (
            <g>
              {ring && <circle cx={x} cy={cy} r={13} fill="none" stroke={ring} strokeWidth="3" opacity="0.8" />}
              <circle cx={x} cy={cy} r={9} fill={fill} stroke={stroke} strokeWidth={lvl ? 2.5 : 1.5} />
              {label && (
                <text x={x} y={cy + 4} fontSize="10" fontWeight="700" fill="#fff" textAnchor="middle" pointerEvents="none">
                  {label}
                </text>
              )}
            </g>
          );
          const temps = (cy: number, tin: number, tout: number, flowRight: boolean) =>
            r && Number.isFinite(tin) ? (
              <g pointerEvents="none">
                <text x={x + (flowRight ? 13 : -13)} y={cy - 8} fontSize="9.5" fill={INK2} textAnchor={flowRight ? 'start' : 'end'}>
                  {num(c.t(tout))}
                </text>
              </g>
            ) : null;
          const loadLabel = (cy: number, below: boolean) => (
            <text x={x} y={cy + (below ? 24 : -16)} fontSize="10.5" fontWeight="600" fill={stroke} textAnchor="middle" pointerEvents="none">
              {num(c.p(u.load))}
              {hl !== undefined && (
                <tspan fill={highlight!.color} fontWeight="700">{hl > 0 ? ' +x' : ' −x'}</tspan>
              )}
            </text>
          );
          const g = (children: React.ReactNode) => (
            <g
              key={u.id}
              style={{ cursor: onMove ? 'ew-resize' : 'pointer' }}
              onPointerDown={(e) => startDrag(u, e)}
              onClick={(e) => e.stopPropagation()}
            >
              <title>{r ? `${num(c.p(u.load))} ${c.pUnit} · ΔT ${num(Math.min(r.dtHot, r.dtCold))} K${r.area ? ` · ${num(r.area)} m²` : ''}` : ''}</title>
              {children}
            </g>
          );
          if (u.kind === 'exchanger') {
            const hr = rowOf.get(u.hot ?? '');
            const cr = rowOf.get(u.cold ?? '');
            if (hr === undefined || cr === undefined) return null;
            const yh = yRow(hr);
            const yc = yRow(cr);
            return g(
              <>
                <line x1={x} x2={x} y1={yh} y2={yc} stroke={stroke} strokeWidth={sel ? 2.5 : 1.5} />
                {circle(yh, '#fff')}
                {circle(yc, '#fff')}
                {temps(yh, r?.hotIn ?? NaN, r?.hotOut ?? NaN, true)}
                {temps(yc, r?.coldIn ?? NaN, r?.coldOut ?? NaN, false)}
                {loadLabel(yc, true)}
              </>,
            );
          }
          const sid = u.kind === 'heater' ? u.cold : u.hot;
          const row = rowOf.get(sid ?? '');
          if (row === undefined) return null;
          const y = yRow(row);
          return g(
            <>
              {circle(y, u.kind === 'heater' ? HEATER : COOLER, u.kind === 'heater' ? 'H' : 'C')}
              {u.kind === 'heater' ? temps(y, r?.coldIn ?? NaN, r?.coldOut ?? NaN, false) : temps(y, r?.hotIn ?? NaN, r?.hotOut ?? NaN, true)}
              {loadLabel(y, true)}
            </>,
          );
        })}

        {rows.length === 0 && (
          <text x={W / 2} y={H / 2} fontSize="13" fill={INK2} textAnchor="middle">
            Add streams on the Data tab to start designing.
          </text>
        )}
      </svg>
      <figcaption className="chart-actions">
        <DownloadMenu
          label="Download grid diagram"
          onPdf={() => svgRef.current && saveSvgPdf(svgRef.current, W, H, filename)}
          onSvg={() => svgRef.current && saveSvgFile(svgRef.current, W, H, filename)}
          onPng={() => svgRef.current && saveSvgPng(svgRef.current, W, H, filename)}
        />
      </figcaption>
      {pending && (
        <div className="grid-hint" role="status">
          {byId.get(pending.stream)?.name} selected. Click a {byId.get(pending.stream)?.kind === 'hot' ? 'cold' : 'hot'} stream to place an exchanger, or Esc to cancel.
        </div>
      )}
    </figure>
  );
}
