import { useEffect, useMemo, useRef, useState } from 'react';
import { niceTicks } from './format';
import { downloadBlob, downloadText } from '../state/storage';

export interface XY {
  x: number;
  y: number;
}

export interface Series {
  id: string;
  label: string;
  color: string;
  points: XY[];
  dash?: string;
  width?: number;
}

export interface RefLine {
  axis: 'x' | 'y';
  value: number;
  label: string;
  /** Put the label under the line (y lines) to avoid collisions */
  below?: boolean;
}

export interface Marker {
  x: number;
  y: number;
  label: string;
  color: string;
}

interface Props {
  title: string;
  subtitle?: string;
  series: Series[];
  xLabel: string;
  yLabel: string;
  xFmt?: (v: number) => string;
  yFmt?: (v: number) => string;
  refLines?: RefLine[];
  markers?: Marker[];
  height?: number;
  filename: string;
  /** Force the x axis to include zero */
  xZero?: boolean;
  yZero?: boolean;
}

// Explicit colours (not CSS variables) so exported SVG/PNG files are standalone.
const INK = '#0b0b0b';
const INK2 = '#52514e';
const GRID = '#ebeae6';
const AXIS = '#b5b3ad';
const SURFACE = '#ffffff';
const FONT = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

const defaultFmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString('en', { maximumFractionDigits: 0 }) : String(+v.toFixed(3)));

export function Chart({ title, subtitle, series, xLabel, yLabel, xFmt = defaultFmt, yFmt = defaultFmt, refLines = [], markers = [], height = 380, filename, xZero, yZero }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<{ px: number; py: number; s: Series; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const visible = series.filter((s) => s.points.length > 0);

  // Legend layout (inside the SVG so exports carry it)
  const legend = useMemo(() => {
    if (visible.length < 2) return { rows: 0, items: [] as { s: Series; x: number; row: number }[] };
    const items: { s: Series; x: number; row: number }[] = [];
    let x = 0;
    let row = 0;
    const maxW = width - 32;
    for (const s of visible) {
      const w = 26 + s.label.length * 6.6 + 18;
      if (x + w > maxW && x > 0) {
        row++;
        x = 0;
      }
      items.push({ s, x, row });
      x += w;
    }
    return { rows: row + 1, items };
  }, [visible, width]);

  const top = 16 + 20 + (subtitle ? 18 : 0) + legend.rows * 20 + 14;
  const m = { l: 64, r: 22, t: top, b: 48 };
  const fullH = height + top - 40;
  const pw = width - m.l - m.r;
  const ph = fullH - m.t - m.b;

  const all = visible.flatMap((s) => s.points).concat(markers);
  const xs = all.map((p) => p.x).concat(refLines.filter((r) => r.axis === 'x').map((r) => r.value));
  const ys = all.map((p) => p.y).concat(refLines.filter((r) => r.axis === 'y').map((r) => r.value));
  if (xZero) xs.push(0);
  if (yZero) ys.push(0);
  const xT = niceTicks(xs.length ? Math.min(...xs) : 0, xs.length ? Math.max(...xs) : 1, Math.max(3, Math.round(pw / 90)));
  const yT = niceTicks(ys.length ? Math.min(...ys) : 0, ys.length ? Math.max(...ys) : 1, Math.max(3, Math.round(ph / 55)));
  const sx = (x: number) => m.l + ((x - xT.lo) / (xT.hi - xT.lo)) * pw;
  const sy = (y: number) => m.t + ph - ((y - yT.lo) / (yT.hi - yT.lo)) * ph;
  const ix = (px: number) => xT.lo + ((px - m.l) / pw) * (xT.hi - xT.lo);
  const iy = (py: number) => yT.lo + ((m.t + ph - py) / ph) * (yT.hi - yT.lo);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const py = ((e.clientY - r.top) / r.height) * fullH;
    let best: { d: number; px: number; py: number; s: Series; x: number; y: number } | null = null;
    for (const s of visible) {
      for (let i = 0; i < s.points.length; i++) {
        const a = s.points[i];
        const b = s.points[Math.min(i + 1, s.points.length - 1)];
        const ax = sx(a.x), ay = sy(a.y), bx = sx(b.x), by = sy(b.y);
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const qx = ax + t * dx, qy = ay + t * dy;
        const d = Math.hypot(px - qx, py - qy);
        if (!best || d < best.d) best = { d, px: qx, py: qy, s, x: ix(qx), y: iy(qy) };
      }
    }
    setHover(best && best.d < 36 ? best : null);
  };

  const exportSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('[data-hover]').forEach((n) => n.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(clone);
  };

  const savePng = (scale = 3) => {
    const text = exportSvg();
    if (!text) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = width * scale;
      c.height = fullH * scale;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = SURFACE;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => b && downloadBlob(b, `${filename}.png`), 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  };

  const savePdf = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('[data-hover]').forEach((n) => n.remove());
    // svg2pdf needs the element in the document to resolve styles
    clone.style.position = 'absolute';
    clone.style.left = '-10000px';
    document.body.appendChild(clone);
    try {
      const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
      const doc = new jsPDF({ orientation: width > fullH ? 'landscape' : 'portrait', unit: 'pt', format: [width, fullH] });
      await addPdfFonts(doc);
      clone.setAttribute('font-family', 'LiberationSans');
      clone.querySelectorAll('[font-family]').forEach((n) => n.setAttribute('font-family', 'LiberationSans'));
      clone.querySelectorAll('[font-weight]').forEach((n) => n.setAttribute('font-weight', Number(n.getAttribute('font-weight')) >= 600 ? 'bold' : 'normal'));
      await svg2pdf(clone, doc, { x: 0, y: 0, width, height: fullH });
      downloadBlob(doc.output('blob'), `${filename}.pdf`);
    } finally {
      clone.remove();
    }
  };

  const path = (pts: XY[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`).join('');

  return (
    <figure className="chart" ref={wrap}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${fullH}`}
        width={width}
        height={fullH}
        role="img"
        aria-label={`${title}. ${subtitle ?? ''}`}
        fontFamily={FONT}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <rect x="0" y="0" width={width} height={fullH} fill={SURFACE} />
        <text x="16" y="28" fontSize="15" fontWeight="600" fill={INK}>{title}</text>
        {subtitle && <text x="16" y="47" fontSize="12" fill={INK2}>{subtitle}</text>}
        {legend.items.map(({ s, x, row }) => {
          const ly = 16 + 20 + (subtitle ? 18 : 0) + 14 + row * 20;
          return (
            <g key={s.id} transform={`translate(${16 + x},${ly})`}>
              <line x1="0" x2="20" y1="-4" y2="-4" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} strokeLinecap="round" />
              <text x="26" y="0" fontSize="12" fill={INK}>{s.label}</text>
            </g>
          );
        })}

        {/* grid + axes */}
        {yT.ticks.map((t) => (
          <g key={`y${t}`}>
            <line x1={m.l} x2={m.l + pw} y1={sy(t)} y2={sy(t)} stroke={GRID} />
            <text x={m.l - 8} y={sy(t) + 4} fontSize="11" textAnchor="end" fill={INK2}>{yFmt(t)}</text>
          </g>
        ))}
        {xT.ticks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={m.t} y2={m.t + ph} stroke={GRID} />
            <text x={sx(t)} y={m.t + ph + 16} fontSize="11" textAnchor="middle" fill={INK2}>{xFmt(t)}</text>
          </g>
        ))}
        <line x1={m.l} x2={m.l + pw} y1={m.t + ph} y2={m.t + ph} stroke={AXIS} />
        <line x1={m.l} x2={m.l} y1={m.t} y2={m.t + ph} stroke={AXIS} />
        <text x={m.l + pw / 2} y={fullH - 10} fontSize="12" textAnchor="middle" fill={INK2}>{xLabel}</text>
        <text transform={`translate(16,${m.t + ph / 2}) rotate(-90)`} fontSize="12" textAnchor="middle" fill={INK2}>{yLabel}</text>

        {/* reference lines */}
        {refLines.map((r, i) =>
          r.axis === 'y' ? (
            <g key={`r${i}`}>
              <line x1={m.l} x2={m.l + pw} y1={sy(r.value)} y2={sy(r.value)} stroke={INK2} strokeDasharray="4 4" strokeWidth="1" />
              <text x={m.l + pw - 4} y={sy(r.value) + (r.below ? 14 : -5)} fontSize="11" textAnchor="end" fill={INK2}>{r.label}</text>
            </g>
          ) : (
            <g key={`r${i}`}>
              <line x1={sx(r.value)} x2={sx(r.value)} y1={m.t} y2={m.t + ph} stroke={INK2} strokeDasharray="4 4" strokeWidth="1" />
              <text x={sx(r.value) + 5} y={m.t + 12} fontSize="11" fill={INK2}>{r.label}</text>
            </g>
          ),
        )}

        {/* data */}
        <g clipPath="none">
          {visible.map((s) => (
            <path key={s.id} d={path(s.points)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
          ))}
        </g>
        {markers.map((mk, i) => (
          <g key={`m${i}`}>
            <circle cx={sx(mk.x)} cy={sy(mk.y)} r="5" fill={mk.color} stroke={SURFACE} strokeWidth="2" />
            <text x={sx(mk.x)} y={sy(mk.y) - 10} fontSize="11" textAnchor="middle" fill={INK}>{mk.label}</text>
          </g>
        ))}

        {/* hover layer */}
        <rect x={m.l} y={m.t} width={pw} height={ph} fill="transparent" data-hover="1" />
        {hover && (
          <g data-hover="1" pointerEvents="none">
            <circle cx={hover.px} cy={hover.py} r="5" fill={hover.s.color} stroke={SURFACE} strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover && (
        <div
          className="tooltip"
          style={{
            left: `${(hover.px / width) * 100}%`,
            top: `${(hover.py / fullH) * 100}%`,
            transform: `translate(${hover.px > width * 0.6 ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
          }}
        >
          <div className="tt-title">
            <span className="swatch" style={{ background: hover.s.color }} />
            {hover.s.label}
          </div>
          <div>{xLabel}: <b>{xFmt(hover.x)}</b></div>
          <div>{yLabel}: <b>{yFmt(hover.y)}</b></div>
        </div>
      )}
      <figcaption className="chart-actions">
        <DownloadMenu
          onSvg={() => { const t = exportSvg(); if (t) downloadText(t, `${filename}.svg`, 'image/svg+xml'); }}
          onPng={() => savePng(3)}
          onPdf={savePdf}
        />
      </figcaption>
    </figure>
  );
}

// PDF fonts: the built-in PDF fonts have no Greek letters (Δ), so embed Liberation Sans
// (SIL OFL 1.1, shipped unmodified in public/fonts). Loaded only when a PDF is made.
let fontCache: Promise<[string, string]> | null = null;
async function addPdfFonts(doc: import('jspdf').jsPDF): Promise<void> {
  const load = async (file: string) => {
    const buf = new Uint8Array(await (await fetch(`${import.meta.env.BASE_URL}fonts/${file}`)).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  fontCache ??= Promise.all([load('LiberationSans-Regular.ttf'), load('LiberationSans-Bold.ttf')]);
  const [regular, bold] = await fontCache;
  doc.addFileToVFS('LiberationSans-Regular.ttf', regular);
  doc.addFileToVFS('LiberationSans-Bold.ttf', bold);
  doc.addFont('LiberationSans-Regular.ttf', 'LiberationSans', 'normal');
  doc.addFont('LiberationSans-Bold.ttf', 'LiberationSans', 'bold');
}

function DownloadMenu({ onSvg, onPng, onPdf }: { onSvg: () => void; onPng: () => void; onPdf: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <div className="menu-root" ref={root}>
      <button className="btn ghost small dl-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Download chart" title="Download" onClick={() => setOpen((o) => !o)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="menu dl-menu" role="menu">
          <button role="menuitem" className="menu-item" onClick={() => pick(onPdf)}><span className="menu-title">PDF</span><span className="menu-sub">Vector, for reports</span></button>
          <button role="menuitem" className="menu-item" onClick={() => pick(onSvg)}><span className="menu-title">SVG</span><span className="menu-sub">Vector, editable</span></button>
          <button role="menuitem" className="menu-item" onClick={() => pick(onPng)}><span className="menu-title">PNG</span><span className="menu-sub">Image, 3× resolution</span></button>
        </div>
      )}
    </div>
  );
}
