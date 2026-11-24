import { useEffect, useRef, useState } from 'react';
import { downloadBlob, downloadText } from '../state/storage';

/** Standalone copy of an on-screen SVG for export, without hover-only parts. */
function exportClone(svg: SVGSVGElement, width: number, height: number): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll('[data-hover]').forEach((n) => n.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  return clone;
}

export function svgString(svg: SVGSVGElement, width: number, height: number): string {
  return new XMLSerializer().serializeToString(exportClone(svg, width, height));
}

export function saveSvgFile(svg: SVGSVGElement, width: number, height: number, filename: string): void {
  downloadText(svgString(svg, width, height), `${filename}.svg`, 'image/svg+xml');
}

/** PNG at `scale`× resolution on a white background. */
export function saveSvgPng(svg: SVGSVGElement, width: number, height: number, filename: string, scale = 3): void {
  const text = svgString(svg, width, height);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = width * scale;
    c.height = height * scale;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => b && downloadBlob(b, `${filename}.png`), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
}

/** Vector PDF (jsPDF + svg2pdf.js, loaded on demand). */
export async function saveSvgPdf(svg: SVGSVGElement, width: number, height: number, filename: string): Promise<void> {
  const clone = exportClone(svg, width, height);
  // svg2pdf needs the element in the document to resolve styles
  clone.style.position = 'absolute';
  clone.style.left = '-10000px';
  document.body.appendChild(clone);
  try {
    const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
    const doc = new jsPDF({ orientation: width > height ? 'landscape' : 'portrait', unit: 'pt', format: [width, height] });
    await addPdfFonts(doc);
    pdfFonts(clone);
    await svg2pdf(clone, doc, { x: 0, y: 0, width, height });
    downloadBlob(doc.output('blob'), `${filename}.pdf`);
  } finally {
    clone.remove();
  }
}

/** Map an SVG's fonts to the embedded Liberation Sans faces (regular and bold only). */
export function pdfFonts(svg: SVGSVGElement): void {
  svg.setAttribute('font-family', 'LiberationSans');
  svg.querySelectorAll('[font-family]').forEach((n) => n.setAttribute('font-family', 'LiberationSans'));
  svg.querySelectorAll('[font-weight]').forEach((n) => {
    const w = n.getAttribute('font-weight');
    n.setAttribute('font-weight', w === 'bold' || Number(w) >= 600 ? 'bold' : 'normal');
  });
  svg.querySelectorAll('[font-style]').forEach((n) => n.setAttribute('font-style', 'normal'));
}

// PDF fonts: the built-in PDF fonts have no Greek letters (Δ), so embed Liberation Sans
// (SIL OFL 1.1, shipped unmodified in public/fonts). Loaded only when a PDF is made.
let fontCache: Promise<[string, string]> | null = null;
export async function addPdfFonts(doc: import('jspdf').jsPDF): Promise<void> {
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

/** Download button (↓) with PDF / SVG / PNG options. */
export function DownloadMenu({ onSvg, onPng, onPdf, label = 'Download chart' }: { onSvg: () => void; onPng: () => void; onPdf: () => void; label?: string }) {
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
      <button className="btn ghost small dl-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} title="Download" onClick={() => setOpen((o) => !o)}>
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
