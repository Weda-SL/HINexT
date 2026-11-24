/**
 * Full PDF report: stream data, targets, problem table and cascade, every
 * curve, cost targets and supertargeting, the HEN design (grid diagram and unit
 * table) and each optimization step. Charts are the app's own SVG components,
 * drawn off-screen and placed in the PDF as vectors (jsPDF + svg2pdf.js).
 */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { CapitalModel, Project } from '../core/types';
import { analyse, supertarget, type Analysis } from '../core/analyse';
import { analyseNetwork, unitName, unitTags, type NetworkResult } from '../core/network';
import { workingNetwork } from '../state/actions';
import { CurvesView } from './CurvesView';
import { CascadeDiagram } from './CascadeDiagram';
import { GridDiagram } from './GridDiagram';
import { SupertargetChart } from './TargetsView';
import { conv, money, num } from './format';
import { addPdfFonts, pdfFonts } from './svgExport';
import { downloadBlob, safeFileName } from '../state/storage';

type Doc = import('jspdf').jsPDF;

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 42;
const CW = PAGE_W - 2 * M;
const INK = [11, 11, 11] as const;
const INK2 = [82, 81, 78] as const;
const LINE = [222, 220, 215] as const;
const PINCH_NOTE = /across the pinch|below the pinch|above the pinch/;

/** Draw the report's charts off-screen and return their SVG elements by key. */
async function drawFigures(project: Project, analysis: Analysis, designNet: NetworkResult, steps: { project: Project; net: NetworkResult }[]): Promise<{ figs: Map<string, SVGSVGElement>; dispose: () => void }> {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-12000px;top:0;width:760px;';
  document.body.appendChild(host);
  const root = createRoot(host);
  const sweep = analysis.cost.capitalNote ? null : supertarget(project);
  const c = conv(project.settings.units);
  const hasDesign = (project.network?.units.length ?? 0) > 0;
  flushSync(() =>
    root.render(
      <div className="report-figures">
        <div data-fig="composites"><CurvesView project={project} analysis={analysis} which="composites" /></div>
        <div data-fig="gcc"><CurvesView project={project} analysis={analysis} which="gcc" /></div>
        <div data-fig="cascade"><CascadeDiagram pt={analysis.pt} c={c} /></div>
        {sweep && sweep.points.some((p) => Number.isFinite(p.total)) && (
          <div data-fig="supertarget"><SupertargetChart project={project} analysis={analysis} sweep={sweep} /></div>
        )}
        {hasDesign && (
          <div data-fig="design"><GridDiagram project={project} analysis={analysis} net={designNet} selected={null} onSelect={() => {}} /></div>
        )}
        {steps.map((st, i) => (
          <div key={i} data-fig={`step-${i}`}>
            <GridDiagram project={st.project} analysis={analysis} net={st.net} selected={null} onSelect={() => {}} issueFilter={(m) => !PINCH_NOTE.test(m)} />
          </div>
        ))}
      </div>,
    ),
  );
  // let the charts measure their width
  await new Promise((r) => setTimeout(r, 120));
  const figs = new Map<string, SVGSVGElement>();
  host.querySelectorAll<HTMLElement>('[data-fig]').forEach((el) => {
    const key = el.dataset.fig!;
    [...el.querySelectorAll<SVGSVGElement>('svg[viewBox]')]
      .filter((svg) => !svg.closest('button')) // skip icons
      .forEach((svg, i) => figs.set(i === 0 ? key : `${key}-${i}`, svg));
  });
  return {
    figs,
    dispose: () => {
      root.unmount();
      host.remove();
    },
  };
}

function capitalText(m: CapitalModel): string {
  const p = (x: { a: number; b: number; c: number }) => `${num(x.a, 6)} + ${num(x.b, 6)}·A^${num(x.c, 6)}`;
  switch (m.kind) {
    case 'power':
      return `Power law, per unit: ${p(m.params)}`;
    case 'linear':
      return `Linear, per unit: ${num(m.a, 6)} + ${num(m.b, 6)}·A`;
    case 'separate':
      return `Separate per type: exchangers ${p(m.exchanger)}; heaters ${p(m.heater)}; coolers ${p(m.cooler)}`;
    case 'custom':
      return `User-defined: ${m.expression}`;
  }
}

export async function exportReport(project: Project, appVersion: string): Promise<void> {
  const analysis = analyse(project);
  const c = conv(project.settings.units);
  const designNet = analyseNetwork(project, analysis, 'pinch');
  const work = workingNetwork(project);
  const history = project.evolution ?? [];
  const steps = history.map((h) => {
    const p: Project = { ...project, network: { ...work, units: h.units } };
    return { project: p, net: analyseNetwork(p, analysis), label: h.label };
  });

  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const doc: Doc = new jsPDF({ unit: 'pt', format: 'a4' });
  await addPdfFonts(doc);
  const { figs, dispose } = await drawFigures(project, analysis, designNet, steps);

  let y = M;
  const font = (size: number, bold = false, color: readonly number[] = INK) => {
    doc.setFont('LiberationSans', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
  };
  const need = (h: number) => {
    if (y + h > PAGE_H - M - 14) {
      doc.addPage();
      y = M;
    }
  };
  const h1 = (t: string) => {
    need(60);
    y += 10;
    font(16, true);
    doc.text(t, M, y + 12);
    y += 22;
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.line(M, y, M + CW, y);
    y += 12;
  };
  const h2 = (t: string) => {
    need(72); // keep a heading with the start of what follows
    font(11.5, true);
    doc.text(t, M, y + 10);
    y += 18;
  };
  const para = (t: string, size = 9.5, color: readonly number[] = INK2) => {
    font(size, false, color);
    const lines = doc.splitTextToSize(t, CW) as string[];
    for (const l of lines) {
      need(size * 1.35);
      doc.text(l, M, y + size);
      y += size * 1.35;
    }
    y += 4;
  };
  /** Simple table with a repeated header, numbers right-aligned. */
  const table = (head: string[], rows: string[][], widths?: number[], align?: ('l' | 'r')[], noHeader = false) => {
    const n = head.length;
    const w = widths ?? head.map(() => CW / n);
    const scale = CW / w.reduce((a, b) => a + b, 0);
    const ws = w.map((x) => x * scale);
    const al = align ?? head.map((_, i) => (i === 0 ? 'l' : 'r'));
    const fs = 8.5;
    const lh = fs * 1.3;
    const pad = 4;
    const cellLines = (txt: string, i: number) => doc.splitTextToSize(txt, ws[i] - 2 * pad) as string[];
    const drawRow = (cells: string[], bold: boolean) => {
      font(fs, bold, bold ? INK2 : INK);
      const lines = cells.map((t, i) => cellLines(t, i));
      const h = Math.max(...lines.map((l) => l.length)) * lh + 2 * pad - 2;
      return { lines, h };
    };
    const header = () => {
      const { lines, h } = drawRow(head, true);
      need(h + 16);
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((l, k) => doc.text(l, al[i] === 'r' ? x + ws[i] - pad : x + pad, y + pad + fs + k * lh, { align: al[i] === 'r' ? 'right' : 'left' }));
        x += ws[i];
      });
      y += h;
      doc.setDrawColor(INK2[0], INK2[1], INK2[2]);
      doc.line(M, y, M + CW, y);
    };
    if (!noHeader) header();
    else {
      need(20);
      doc.setDrawColor(INK2[0], INK2[1], INK2[2]);
      doc.line(M, y, M + CW, y);
    }
    for (const r of rows) {
      const { lines, h } = drawRow(r, false);
      if (y + h > PAGE_H - M - 14) {
        doc.addPage();
        y = M;
        if (!noHeader) header();
      }
      font(fs, false, INK);
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((l, k) => doc.text(l, al[i] === 'r' ? x + ws[i] - pad : x + pad, y + pad + fs + k * lh, { align: al[i] === 'r' ? 'right' : 'left' }));
        x += ws[i];
      });
      y += h;
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.line(M, y, M + CW, y);
    }
    y += 12;
  };
  const kv = (rows: [string, string][]) => table(['', ''], rows, [3, 2], ['l', 'r'], true);
  /** Place an off-screen SVG as a vector figure, scaled to the text width. */
  const figure = async (key: string, maxH = PAGE_H - 2 * M - 30, title?: string) => {
    const svg = figs.get(key);
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    let w = CW;
    let h = (vb.height / vb.width) * w;
    if (h > maxH) {
      w = (maxH / h) * w;
      h = maxH;
    }
    need(h + 10 + (title ? 20 : 0));
    if (title) h2(title);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll('[data-hover]').forEach((n) => n.remove());
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(vb.width));
    clone.setAttribute('height', String(vb.height));
    clone.style.cssText = 'position:absolute;left:-12000px;top:0';
    document.body.appendChild(clone);
    try {
      pdfFonts(clone);
      await svg2pdf(clone, doc, { x: M + (CW - w) / 2, y, width: w, height: h });
    } finally {
      clone.remove();
    }
    y += h + 12;
  };

  try {
    // ---- title ----
    font(9, false, INK2);
    doc.text('HINexT — Pinch Analysis report', M, y + 9);
    y += 22;
    font(20, true);
    for (const l of doc.splitTextToSize(project.name || 'Untitled project', CW) as string[]) {
      doc.text(l, M, y + 18);
      y += 24;
    }
    y += 4;
    para(
      `${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · HINexT ${appVersion} · ΔTmin ${num(analysis.dtMin)} K · units ${c.tUnit}, ${c.pUnit}`,
      9.5,
    );
    if (project.description) para(project.description, 10, INK);
    const errors = analysis.issues.filter((i) => i.level === 'error');
    if (errors.length) para(`Input errors: ${errors.map((e) => e.message).join(' ')}`, 9.5, [180, 35, 24]);

    // ---- 1. data ----
    h1('1. Stream and utility data');
    h2('Process streams');
    table(
      ['#', 'Name', 'Type', `T supply (${c.tUnit})`, `T target (${c.tUnit})`, `CP (${c.cpUnit})`, `Heat load (${c.pUnit})`, 'h (kW/m²K)', 'ΔT contrib. (K)'],
      analysis.streams.map((s, i) => [
        String(i + 1),
        s.name,
        s.kind === 'hot' ? 'Hot' : 'Cold',
        num(c.t(s.ts)),
        num(c.t(s.tt)),
        s.nonlinear ? 'varies' : num(c.p(s.cp), 4),
        num(c.p(s.duty)),
        s.h !== undefined && Number.isFinite(s.h) ? num(s.h, 4) : '—',
        num(s.dtc),
      ]),
      [0.5, 2.4, 0.9, 1.3, 1.3, 1.2, 1.4, 1.1, 1.2],
      ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r'],
    );
    h2('Utilities');
    table(
      ['Name', 'Type', `T supply (${c.tUnit})`, `T target (${c.tUnit})`, 'Cost ($/kW·yr)', 'h (kW/m²K)', `Max duty (${c.pUnit})`],
      project.utilities.map((u) => [
        u.name,
        u.kind === 'hot' ? 'Hot' : 'Cold',
        num(c.t(u.tSupply)),
        num(c.t(u.tTarget)),
        num(u.cost),
        u.h !== undefined && Number.isFinite(u.h) ? num(u.h, 4) : '—',
        typeof u.maxDuty === "number" && Number.isFinite(u.maxDuty) ? num(c.p(u.maxDuty)) : "—",
      ]),
      [2.2, 0.9, 1.3, 1.3, 1.3, 1.1, 1.3],
      ['l', 'l', 'r', 'r', 'r', 'r', 'r'],
    );

    // ---- 2. energy targets ----
    const pt = analysis.pt;
    h1('2. Energy targets');
    kv([
      ['Minimum hot utility, QH,min', `${num(c.p(pt.qhMin))} ${c.pUnit}`],
      ['Minimum cold utility, QC,min', `${num(c.p(pt.qcMin))} ${c.pUnit}`],
      ...(pt.pinches.length
        ? pt.pinches.map((p, i): [string, string] => [`Pinch${pt.pinches.length > 1 ? ` ${i + 1}` : ''} (shifted / hot / cold)`, `${num(c.t(p))} / ${num(c.t(p + analysis.dtMin / 2))} / ${num(c.t(p - analysis.dtMin / 2))} ${c.tUnit}`])
        : [['Pinch', pt.threshold ? 'None (threshold problem)' : 'None'] as [string, string]]),
      ...analysis.utilityTargets.filter((u) => u.duty > 0).map((u): [string, string] => [`  ${u.name}`, `${num(c.p(u.duty))} ${c.pUnit}${u.limited ? ' (limited)' : ''}`]),
    ]);
    h2('Problem table');
    table(
      ['Interval', `T* top (${c.tUnit})`, `T* bottom (${c.tUnit})`, 'ΔT (K)', `ΣCPhot − ΣCPcold (${c.cpUnit})`, `ΔH (${c.pUnit})`, 'Balance'],
      pt.intervals.map((iv, i) => [String(i + 1), num(c.t(iv.tTop)), num(c.t(iv.tBot)), num(iv.dT), num(c.p(iv.netCp), 4), num(c.p(iv.dH)), Math.abs(iv.dH) < 1e-9 ? 'balanced' : iv.dH > 0 ? 'surplus' : 'deficit']),
      [0.8, 1.1, 1.1, 0.8, 1.6, 1.1, 1],
      ['l', 'r', 'r', 'r', 'r', 'r', 'l'],
    );
    h2('Heat cascade');
    table(
      [`T* (${c.tUnit})`, `Flow, zero hot utility (${c.pUnit})`, `Flow, with QH,min (${c.pUnit})`],
      pt.boundaries.map((b, i) => [num(c.t(b)), num(c.p(pt.infeasible[i])), num(c.p(pt.feasible[i]))]),
    );
    await figure('cascade', 520);
    await figure('composites', 330, 'Curves');
    await figure('composites-1', 330);
    await figure('gcc', 330);
    await figure('gcc-1', 330);

    // ---- 3. cost targets ----
    const { units, area, cost } = analysis;
    h1('3. Cost targets');
    kv([
      ['Minimum units, MER design', String(units.mer)],
      ['Minimum units, ignoring the pinch', String(units.overall)],
      ['Total area (Bath formula)', area.total === null ? '—' : `${num(area.total)} m²`],
      ['Operating cost', `${money(cost.operating)}/yr`],
      ['Capital cost (installed)', money(cost.capital)],
      ['Annualised capital', `${money(cost.capitalAnnual)}/yr`],
      ['Total annual cost', `${money(cost.total)}/yr`],
    ]);
    para(`${capitalText(project.economics.capital)} ($, A in m²). Annualised at ${num(project.economics.interestRate * 100)} % over ${num(project.economics.plantLife)} years (factor ${num(cost.annualisationFactor, 4)}).${cost.capitalNote ? ` ${cost.capitalNote}` : ''}`);
    h2('Utility costs');
    table(
      ['Utility', `Duty (${c.pUnit})`, 'Cost ($/kW·yr)', 'Annual cost ($/yr)'],
      analysis.utilityTargets.map((u) => [u.name, num(c.p(u.duty)), num(project.utilities.find((x) => x.id === u.id)?.cost ?? NaN), money(u.duty * (project.utilities.find((x) => x.id === u.id)?.cost ?? NaN))]),
    );
    await figure('supertarget', 340, 'Supertargeting');

    // ---- 4. HEN design ----
    const tags = unitTags(project.network?.units ?? []);
    const sMap = new Map(analysis.streams.map((s) => [s.id, s]));
    const uMap = new Map(analysis.utilities.map((u) => [u.id, u]));
    if (designNet.units.length) {
      h1('4. Heat exchanger network design (MER)');
      await figure('design');
      table(
        ['Unit', `Load (${c.pUnit})`, `Hot side (${c.tUnit})`, `Cold side (${c.tUnit})`, 'ΔT hot / cold end (K)', 'LMTD (K)', 'Area (m²)', 'Capital ($)'],
        designNet.units.map((r) => {
          const u = project.network!.units.find((v) => v.id === r.id)!;
          const br = [u.hotBranch !== undefined && u.hot ? `${sMap.get(u.hot)?.name} branch ${u.hotBranch + 1}` : '', u.coldBranch !== undefined && u.cold ? `${sMap.get(u.cold)?.name} branch ${u.coldBranch + 1}` : ''].filter(Boolean);
          return [
            unitName(u, sMap, uMap, tags) + (br.length ? `, on ${br.join(' and ')}` : ''),
            num(c.p(r.load)),
            `${num(c.t(r.hotIn))} → ${num(c.t(r.hotOut))}`,
            `${num(c.t(r.coldIn))} → ${num(c.t(r.coldOut))}`,
            `${num(r.dtHot)} / ${num(r.dtCold)}`,
            num(r.lmtd),
            num(r.area),
            money(r.capital),
          ];
        }),
        [2.6, 1, 1.5, 1.5, 1.4, 0.9, 1, 1.2],
        ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'r'],
      );
      const splits = project.network?.splits ?? [];
      if (splits.length) {
        h2('Stream splits');
        table(
          ['Stream', 'Side of the pinch', `Branch CPs (${c.cpUnit})`],
          splits.map((sp) => {
            const s = sMap.get(sp.stream);
            const t = sp.fractions.reduce((a, b) => a + b, 0);
            return [s?.name ?? sp.stream, sp.side === 'above' ? 'Above' : 'Below', sp.fractions.map((f) => (s && !s.nonlinear ? num(c.p((s.cp * f) / t), 4) : `${num((f / t) * 100)} %`)).join(' + ')];
          }),
          [2, 1.5, 2.5],
          ['l', 'l', 'l'],
        );
      }
      h2('Design against targets');
      table(
        ['', 'Design', 'Target'],
        [
          [`Hot utility (${c.pUnit})`, num(c.p(designNet.qh)), num(c.p(pt.qhMin))],
          [`Cold utility (${c.pUnit})`, num(c.p(designNet.qc)), num(c.p(pt.qcMin))],
          ['Units', String(designNet.unitCount), `${units.mer} (MER)`],
          ['Area (m²)', num(designNet.area), area.total === null ? '—' : num(area.total)],
          ['Total annual cost ($/yr)', money(designNet.total), money(cost.total)],
        ],
      );
      const problems = designNet.issues.filter((i) => i.level === 'error' || /ΔTmin|cross|CP hot|across the pinch/.test(i.message));
      if (problems.length) para(`Checks: ${problems.map((i) => i.message).join(' ')}`, 9, [154, 103, 0]);
    }

    // ---- 5. optimization ----
    if (steps.length) {
      h1('5. Optimization (network evolution)');
      table(
        ['Step', 'Change', 'Units', `Hot utility (${c.pUnit})`, `Cold utility (${c.pUnit})`, 'Area (m²)', 'Total annual cost ($/yr)'],
        steps.map((st, i) => [String(i), st.label, String(st.net.unitCount), num(c.p(st.net.qh)), num(c.p(st.net.qc)), num(st.net.area), money(st.net.total)]),
        [0.6, 3.4, 0.7, 1.1, 1.1, 1, 1.4],
        ['l', 'l', 'r', 'r', 'r', 'r', 'r'],
      );
      for (let i = 0; i < steps.length; i++) await figure(`step-${i}`, 380, `Step ${i}: ${steps[i].label}`);
    }

    // ---- page footers ----
    const pages = doc.getNumberOfPages();
    for (let k = 1; k <= pages; k++) {
      doc.setPage(k);
      font(8, false, INK2);
      doc.text(`${project.name} · HINexT report`, M, PAGE_H - 22);
      doc.text(`${k} / ${pages}`, PAGE_W - M, PAGE_H - 22, { align: 'right' });
    }
    downloadBlob(doc.output('blob'), `${safeFileName(project.name)}_report.pdf`);
  } finally {
    dispose();
  }
}
