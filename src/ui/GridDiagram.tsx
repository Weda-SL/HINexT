import { useEffect, useRef, useState } from 'react';
import type { NetUnit, Project } from '../core/types';
import type { Analysis } from '../core/analyse';
import { branchIndex, PINCH_X, regionOf, splitMap, unitTags, type NetworkResult, type Region } from '../core/network';
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
const COOLER = '#2a78d6';
const FONT = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

export interface Highlight {
  /** unit id → sign of the load shift (+1 / −1), drawn as + / − badges */
  units: Map<string, 1 | -1>;
  color: string;
  /** Show the +x / −x tags next to the loads (off once x is set, so the loads read as final values) */
  marks?: boolean;
}

interface Props {
  project: Project;
  analysis: Analysis;
  net: NetworkResult;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Create a match between two streams at position x (undefined = read-only) */
  onMatch?: (hot: string, cold: string, x: number, hotBranch?: number, coldBranch?: number) => void;
  /** Click on a stream's name (to edit its splits) */
  onStreamClick?: (stream: string) => void;
  /** Stream whose name is highlighted (being edited) */
  selectedStream?: string | null;
  onMove?: (id: string, x: number) => void;
  onAddUtility?: (stream: string) => void;
  /** Side of the pinch being worked on; the other side is muted (only used when there is a pinch) */
  section?: 'above' | 'below' | null;
  onSection?: (s: 'above' | 'below' | null) => void;
  /** Which unit issues colour a unit (default: all) */
  issueFilter?: (message: string) => boolean;
  /** Extra controls shown left of the download button */
  actions?: React.ReactNode;
  /** Delete a unit (shows a × on the selected unit and enables the Delete key) */
  onDelete?: (id: string) => void;
  /** Duty a heater/cooler would take on this stream (region-aware) */
  utilityDuty?: (stream: string) => number;
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

export function GridDiagram({ project, analysis, net, selected, onSelect, onMatch, onStreamClick, selectedStream, onMove, onAddUtility, onDelete, section, onSection, actions, issueFilter, utilityDuty, highlight, editable }: Props) {
  const c = conv(project.settings.units);
  const svgRef = useRef<SVGSVGElement>(null);
  const [pending, setPending] = useState<{ stream: string; x: number; branch?: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number } | null>(null);
  const units = project.network?.units ?? [];
  const pinch = analysis.pt.pinches[0];
  const hots = analysis.streams.filter((s) => s.kind === 'hot');
  const colds = analysis.streams.filter((s) => s.kind === 'cold');
  const rows = [...hots, ...colds];
  const rowOf = new Map(rows.map((s, i) => [s.id, i]));
  const byId = new Map(rows.map((s) => [s.id, s]));
  const res = new Map(net.units.map((r) => [r.id, r]));
  const tags = unitTags(units);
  const issueLevel = new Map<string, 'error' | 'warning'>();
  const issueText = new Map<string, string[]>();
  for (const i of net.issues) {
    if (!i.unit || (issueFilter && !issueFilter(i.message))) continue;
    if (issueLevel.get(i.unit) !== 'error') issueLevel.set(i.unit, i.level);
    issueText.set(i.unit, [...(issueText.get(i.unit) ?? []), i.message]);
  }

  const W = 1100;
  // a column for branch CPs between the stream CP and the lines, when any stream is split
  const splitsEarly = splitMap(project);
  const pillW = (txt: string) => Math.max(24, txt.length * 6.4 + 12);
  const branchTxt = (s: ResolvedStream, f: number) => (s.nonlinear ? `${num(f * 100)}%` : num(c.p(s.cp * f)));
  const branchCol = (s: ResolvedStream, reg: 'above' | 'below') => {
    const fr = splitsEarly.get(`${s.id}|${reg}`);
    return fr ? Math.max(...fr.map((f) => pillW(branchTxt(s, f)))) : 0;
  };
  const colsOf = (s: ResolvedStream) => (['above', 'below'] as const).reduce((t, r) => t + (branchCol(s, r) ? branchCol(s, r) + 6 : 0), 0);
  const COLS = Math.max(0, ...rows.map(colsOf));
  const L = 190 + COLS;
  const R = 150;
  const top = 58;
  const rowH = 54;
  const gap = hots.length && colds.length ? 22 : 0;
  // split streams: branches drawn below the main line, BR apart; the row grows to fit them
  const BR = 36;
  const splits = splitMap(project);
  const hasPinch = pinch !== undefined;
  const branchesOf = (sid: string, reg: Region) => splits.get(`${sid}|${reg}`);
  const extraOf = (sid: string) => Math.max(0, ...(['above', 'below'] as const).map((r) => ((branchesOf(sid, r)?.length ?? 1) - 1) * BR));
  const rowTop: number[] = [];
  {
    let y = top;
    rows.forEach((r, i) => {
      if (i === hots.length && i > 0) y += gap;
      rowTop.push(y);
      y += rowH + extraOf(r.id);
    });
  }
  const yRow = (i: number) => rowTop[i] ?? top;
  const lastRow = rows.length - 1;
  const H = (rows.length ? yRow(lastRow) + extraOf(rows[lastRow].id) : top) + 70;
  /** y of a unit's connection on a stream (its branch line when the stream is split there) */
  const unitY = (u: NetUnit, sid: string, kind: 'hot' | 'cold') => {
    const row = rowOf.get(sid);
    if (row === undefined) return undefined;
    const fr = branchesOf(sid, regionOf(unitX(u), hasPinch));
    return yRow(row) + (fr ? branchIndex(u, kind, fr.length) * BR : 0);
  };
  const px = (x: number) => L + x * (W - L - R);
  const ix = (p: number) => Math.min(0.98, Math.max(0.02, (p - L) / (W - L - R)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pending) setPending(null);
        else onSection?.(null);
      }
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selected && onDelete) {
        e.preventDefault();
        onDelete(selected);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, onDelete, pending, onSection]);

  const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  };

  const sections = pinch !== undefined && !!onSection;
  const sideOf = (x: number): 'above' | 'below' => (x < PINCH_X ? 'above' : 'below');
  const clickStream = (s: ResolvedStream, e: React.MouseEvent, branch?: number) => {
    if (!onMatch) return;
    e.stopPropagation();
    const x = ix(toLocal(e));
    if (sections && !pending) onSection!(sideOf(x));
    if (!pending) {
      setPending({ stream: s.id, x, branch });
      return;
    }
    if (pending.stream === s.id) {
      setPending(pending.branch === branch ? null : { stream: s.id, x, branch });
      return;
    }
    const first = byId.get(pending.stream)!;
    if (first.kind === s.kind) {
      setPending({ stream: s.id, x, branch });
      return;
    }
    const hot = first.kind === 'hot' ? first.id : s.id;
    const cold = first.kind === 'cold' ? first.id : s.id;
    const hb = first.kind === 'hot' ? pending.branch : branch;
    const cb = first.kind === 'cold' ? pending.branch : branch;
    onMatch(hot, cold, pending.x, hb, cb);
    setPending(null);
  };

  const unitX = (u: NetUnit) => (drag?.id === u.id ? drag.x : u.x);

  const startDrag = (u: NetUnit, e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect(u.id);
    if (sections) onSection!(sideOf(u.x));
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
        onClick={(e) => {
          setPending(null);
          onSelect(null);
          if (sections) {
            const p = toLocal(e);
            onSection!(p >= L - 20 && p <= W - R ? sideOf(ix(p)) : null);
          }
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
        <text x={L - 10 - COLS} y={26} fontSize="11.5" fill={INK2} textAnchor="end">Stream · CP ({c.cpUnit})</text>
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
            {(['above', 'below'] as const).map((side) => {
              const on = sections && section === side;
              return (
                <text
                  key={side}
                  x={px(side === 'above' ? 0.25 : 0.75)}
                  y={26}
                  fontSize="11.5"
                  fontWeight={on ? 700 : 400}
                  fill={on ? INK : INK3}
                  textAnchor="middle"
                  style={sections ? { cursor: 'pointer' } : undefined}
                  onClick={(e) => {
                    if (!sections) return;
                    e.stopPropagation();
                    onSection!(section === side ? null : side);
                  }}
                >
                  {side} the pinch
                </text>
              );
            })}
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
                const right = L - 10 - COLS;
                return (
                  <>
                    <text
                      x={right - pw - 8}
                      y={y + 4}
                      fontSize="12.5"
                      fontWeight={selectedStream === s.id ? 800 : 600}
                      fill={color}
                      textAnchor="end"
                      textDecoration={selectedStream === s.id ? 'underline' : undefined}
                      style={onStreamClick ? { cursor: 'pointer' } : undefined}
                      onClick={(e) => {
                        if (!onStreamClick) return;
                        e.stopPropagation();
                        onStreamClick(s.id);
                      }}
                    >
                      <title>{onStreamClick ? 'Click to split this stream' : s.name}</title>
                      {s.name}
                    </text>
                    <rect x={right - pw} y={y - 9} width={pw} height={18} rx={9} fill={s.kind === 'hot' ? '#fdecec' : '#e8f1fc'} />
                    <text x={right - pw / 2} y={y + 4} fontSize="11" fontWeight="600" fill={s.kind === 'hot' ? '#a32625' : '#1d5aa6'} textAnchor="middle">
                      {cpText}
                    </text>
                    {/* branch CPs: purple pills in a column right of the stream's CP, each level with its branch line */}
                    {(() => {
                      let x0 = right + 6;
                      return (['above', 'below'] as const)
                        .filter((reg) => branchesOf(s.id, reg))
                        .map((reg) => {
                          const colW = branchCol(s, reg);
                          const xl = x0;
                          x0 += colW + 6;
                          return { reg, colW, xl };
                        });
                    })().map(({ reg, colW, xl }) =>
                        branchesOf(s.id, reg)!.map((f, k) => {
                          const txt = branchTxt(s, f);
                          const w = colW;
                          const xr = xl + w;
                          const yb = y + k * BR;
                          return (
                            <g key={`${reg}-${k}`}>
                              <title>{`Branch ${k + 1}${hasPinch ? ` ${reg} the pinch` : ''}: ${s.nonlinear ? txt + ' of the flow' : 'CP ' + txt}`}</title>
                              <rect x={xr - w} y={yb - 8} width={w} height={16} rx={8} fill="#ece9fb" stroke="#c9c2f2" />
                              <text x={xr - w / 2} y={yb + 3.5} fontSize="10" fontWeight="600" fill={PINCH} textAnchor="middle">{txt}</text>
                            </g>
                          );
                        }),
                      )}
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
              {/* branches of a split: parallel lines below the main one over that side of the pinch */}
              {(['above', 'below'] as const).map((reg) => {
                const fr = branchesOf(s.id, reg);
                if (!fr) return null;
                const lo = Math.max(a, !hasPinch || reg === 'above' ? 0 : PINCH_X);
                const hi = Math.min(b, !hasPinch || reg === 'below' ? 1 : PINCH_X);
                if (hi - lo < 1e-6) return null;
                // rejoin well before the arrow head (hot streams end on the right, cold on the left)
                const xa = px(lo) + (lo === a ? (s.kind === 'cold' ? 36 : 14) : 4);
                const xb = px(hi) - (hi === b ? (s.kind === 'hot' ? 36 : 14) : 4);
                return (
                  <g key={reg}>
                    {fr.map((_f, k) => {
                      const yb = y + k * BR;
                      return (
                        <g key={k}>
                          {k > 0 && (
                            <path d={`M${xa} ${y} L${xa + 12} ${yb} L${xb - 12} ${yb} L${xb} ${y}`} fill="none" stroke={color} strokeWidth={isPending && pending?.branch === k ? 4 : 2.5} strokeLinejoin="round" />
                          )}
                          {onMatch && k > 0 && (
                            <rect
                              x={xa + 8}
                              y={yb - 13}
                              width={Math.max(4, xb - xa - 16)}
                              height={26}
                              fill={isPending && pending?.branch === k ? 'rgba(75,60,192,0.08)' : canPair ? 'rgba(42,120,214,0.05)' : 'transparent'}
                              style={{ cursor: 'crosshair' }}
                              onClick={(e) => clickStream(s, e, k)}
                              data-hover="1"
                            />
                          )}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
              {/* supply / target temperatures */}
              {s.kind === 'hot' ? (
                <>
                  <text x={x1 - 2} y={y - 8} fontSize="10.5" fill={INK2}>{num(c.t(s.ts))}°</text>
                  <text x={x2 + 2} y={y - 8} fontSize="10.5" fill={INK2} textAnchor="end">{num(c.t(s.tt))}°</text>
                </>
              ) : (
                <>
                  <text x={x2 + 2} y={y - 8} fontSize="10.5" fill={INK2} textAnchor="end">{num(c.t(s.ts))}°</text>
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
                  onClick={(e) => {
                    const xx = ix(toLocal(e));
                    clickStream(s, e, branchesOf(s.id, regionOf(xx, hasPinch)) ? 0 : undefined);
                  }}
                  data-hover="1"
                />
              )}
              {isPending && (
                <circle cx={px(pending.x)} cy={y + (pending.branch ?? 0) * BR} r={9} fill="none" stroke={PINCH} strokeWidth="2" strokeDasharray="3 2" data-hover="1" />
              )}
              {/* remaining duty at the stream end */}
              {sr && Math.abs(remaining) > 1e-6 && (() => {
                const util = utilityDuty ? utilityDuty(s.id) : Math.max(0, remaining);
                // with sections, heater pills belong to the above side and cooler pills to the below side
                if (sections && remaining > 0 && util > 1e-9 && section !== (s.kind === 'cold' ? 'above' : 'below')) return null;
                const canAdd = !!(editable && onAddUtility && util > 1e-9);
                const over = remaining < 0;
                const label = over
                  ? `over by ${num(c.p(-remaining))}`
                  : util > 1e-9
                    ? `${editable ? '+ ' : ''}${s.kind === 'hot' ? 'cool' : 'heat'} ${num(c.p(util))}`
                    : `${num(c.p(remaining))} to match`;
                const bg = over ? '#fdecea' : util > 1e-9 ? (s.kind === 'hot' ? '#e8f1fc' : '#fff0e8') : '#f1f0ed';
                const fg = over ? ERR : util > 1e-9 ? (s.kind === 'hot' ? '#1d5aa6' : '#a8461c') : INK2;
                return (
                  <g
                    transform={`translate(${W - R + 22}, ${y})`}
                    style={{ cursor: canAdd ? 'pointer' : 'default' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canAdd) onAddUtility!(s.id);
                    }}
                  >
                    <title>
                      {util > 1e-9 && util < remaining - 1e-6
                        ? `${num(c.p(util))} on the ${s.kind === 'hot' ? 'below' : 'above'}-pinch side for a ${s.kind === 'hot' ? 'cooler' : 'heater'}; ${num(c.p(remaining - util))} still to match with exchangers`
                        : util > 1e-9
                          ? `Add a ${s.kind === 'hot' ? 'cooler' : 'heater'} for this duty`
                          : `Unmatched heat ${s.kind === 'hot' ? 'above' : 'below'} the pinch: match it with exchangers, not a ${s.kind === 'hot' ? 'cooler' : 'heater'}`}
                    </title>
                    <rect x={0} y={-10} width={118} height={20} rx={10} fill={bg} />
                    <text x={59} y={4} fontSize="11" fontWeight="600" textAnchor="middle" fill={fg}>{label}</text>
                  </g>
                );
              })()}
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
              {ring && <circle cx={x} cy={cy} r={15} fill="none" stroke={ring} strokeWidth="3" opacity="0.8" />}
              <circle cx={x} cy={cy} r={11} fill={fill} stroke={stroke} strokeWidth={lvl ? 2.5 : 1.5} />
              {label && (
                <text x={x} y={cy + 3.5} fontSize="9.5" fontWeight="700" fill={fill === '#fff' ? stroke : '#fff'} textAnchor="middle" pointerEvents="none">
                  {label}
                </text>
              )}
            </g>
          );
          const temps = (cy: number, tin: number, tout: number, flowRight: boolean, streamId?: string) =>
            r && Number.isFinite(tin) && !(streamId && Math.abs(tout - (byId.get(streamId)?.tt ?? NaN)) < 1e-6) ? (
              <g pointerEvents="none">
                <text x={x + (flowRight ? 15 : -15)} y={cy - 8} fontSize="9.5" fill={INK2} textAnchor={flowRight ? 'start' : 'end'}>
                  {num(c.t(tout))}
                </text>
              </g>
            ) : null;
          const loadLabel = (cy: number, below: boolean) => (
            <text x={x} y={cy + (below ? 26 : -18)} fontSize="10.5" fontWeight="600" fill={stroke} textAnchor="middle" pointerEvents="none">
              {num(c.p(u.load))}
              {hl !== undefined && highlight!.marks !== false && (
                <tspan fill={highlight!.color} fontWeight="700">{hl > 0 ? ' +x' : ' −x'}</tspan>
              )}
            </text>
          );
          const del = (cy: number) =>
            sel && onDelete ? (
              <g
                data-hover
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onDelete(u.id); }}
              >
                <title>Delete (Del key)</title>
                <circle cx={x} cy={cy - 27} r={9} fill="transparent" />
                <path className="unit-del" d={`M${x - 4} ${cy - 31} l8 8 M${x + 4} ${cy - 31} l-8 8`} stroke="#b8bcc4" strokeWidth="1.8" strokeLinecap="round" pointerEvents="none" />
              </g>
            ) : null;
          const g = (children: React.ReactNode) => (
            <g
              key={u.id}
              style={{ cursor: onMove ? 'ew-resize' : 'pointer' }}
              onPointerDown={(e) => startDrag(u, e)}
              onClick={(e) => e.stopPropagation()}
            >
              <title>{(r ? `${num(c.p(u.load))} ${c.pUnit} · ΔT ${num(Math.min(r.dtHot, r.dtCold))} K${r.area ? ` · ${num(r.area)} m²` : ''}` : '') + (issueText.get(u.id) ? `\n${issueText.get(u.id)!.join('\n')}` : '')}</title>
              {children}
            </g>
          );
          if (u.kind === 'exchanger') {
            const yh = unitY(u, u.hot ?? '', 'hot');
            const yc = unitY(u, u.cold ?? '', 'cold');
            if (yh === undefined || yc === undefined) return null;
            return g(
              <>
                <line x1={x} x2={x} y1={yh} y2={yc} stroke={stroke} strokeWidth={sel ? 2.5 : 1.5} />
                {circle(yh, '#fff', tags.get(u.id)?.slice(1))}
                {circle(yc, '#fff', tags.get(u.id)?.slice(1))}
                {temps(yh, r?.hotIn ?? NaN, r?.hotOut ?? NaN, true, u.hot)}
                {temps(yc, r?.coldIn ?? NaN, r?.coldOut ?? NaN, false, u.cold)}
                {loadLabel(yc, true)}
                {del(Math.min(yh, yc))}
              </>,
            );
          }
          const sid = u.kind === 'heater' ? u.cold : u.hot;
          const yy = unitY(u, sid ?? '', u.kind === 'heater' ? 'cold' : 'hot');
          if (yy === undefined) return null;
          const y = yy;
          return g(
            <>
              {circle(y, u.kind === 'heater' ? HEATER : COOLER, tags.get(u.id))}
              {u.kind === 'heater' ? temps(y, r?.coldIn ?? NaN, r?.coldOut ?? NaN, false, u.cold) : temps(y, r?.hotIn ?? NaN, r?.hotOut ?? NaN, true, u.hot)}
              {loadLabel(y, true)}
              {del(y)}
            </>,
          );
        })}

        {/* mute the side not being worked on */}
        {sections && section && (
          <rect
            data-hover="1"
            x={section === 'above' ? px(PINCH_X) + 1 : L - 4}
            y={36}
            width={section === 'above' ? px(1) - px(PINCH_X) + 4 : px(PINCH_X) - L + 3}
            height={H - 64}
            fill="#ffffff"
            opacity={0.65}
            pointerEvents="none"
          />
        )}

        {rows.length === 0 && (
          <text x={W / 2} y={H / 2} fontSize="13" fill={INK2} textAnchor="middle">
            Add streams on the Energy targets tab to start designing.
          </text>
        )}
      </svg>
      <figcaption className="chart-actions">
        {actions}
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
