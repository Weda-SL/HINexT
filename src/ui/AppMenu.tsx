import { useEffect, useRef, useState } from 'react';
import { EXAMPLES, type Example } from '../examples';

interface Props {
  onNew: () => void;
  onFile: () => void;
  onSave: () => void;
  onShare: () => void;
  onReport: () => void;
  onExample: (ex: Example) => void;
}

/** Main menu (☰): new project, open a file, save to a file, or open a built-in example. */
export function AppMenu({ onNew, onFile, onSave, onShare, onReport, onExample }: Props) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setSub(false);
      return;
    }
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
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
      <button className="btn ghost icon-btn menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Menu" title="Menu" onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" className="menu-item" onClick={() => pick(onNew)}>
            <span className="menu-title">New blank project</span>
            <span className="menu-sub">No streams; default steam and cooling water</span>
          </button>
          <button role="menuitem" className="menu-item" onClick={() => pick(onFile)}>
            <span className="menu-title">Open a file…</span>
            <span className="menu-sub">.pinch project from this computer</span>
          </button>
          <button role="menuitem" className="menu-item" onClick={() => pick(onSave)}>
            <span className="menu-title">Save to a file <span className="kbd">Ctrl+S</span></span>
            <span className="menu-sub">Download this project as a .pinch file</span>
          </button>
          <button role="menuitem" className="menu-item" onClick={() => pick(onReport)}>
            <span className="menu-title">Export as PDF</span>
            <span className="menu-sub">Full report: data, targets, curves, design and optimization steps</span>
          </button>
          <button role="menuitem" className="menu-item" onClick={() => pick(onShare)}>
            <span className="menu-title">Share link…</span>
            <span className="menu-sub">The project packed into a link; nothing is uploaded</span>
          </button>
          <div className="submenu-root" onPointerEnter={() => setSub(true)} onPointerLeave={() => setSub(false)}>
            <button
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub}
              className={`menu-item has-sub ${sub ? 'active' : ''}`}
              onClick={() => setSub((v) => !v)}
              onKeyDown={(e) => e.key === 'ArrowRight' && setSub(true)}
            >
              <span className="menu-title">Examples</span>
              <span className="menu-sub">Published benchmark cases</span>
              <span className="sub-arrow" aria-hidden="true">›</span>
            </button>
            {sub && (
              <div className="menu submenu" role="menu" onKeyDown={(e) => e.key === 'ArrowLeft' && setSub(false)}>
                {EXAMPLES.map((ex) => (
                  <button key={ex.key} role="menuitem" className="menu-item" onClick={() => pick(() => onExample(ex))}>
                    <span className="menu-title">{ex.title}</span>
                    <span className="menu-sub">
                      {(() => {
                        const mw = ex.published.qh >= 5000;
                        const f = (v: number) => (mw ? `${v / 1000} MW` : `${v} kW`);
                        return `ΔTmin ${ex.published.dtMin} K · QH,min ${f(ex.published.qh)} · QC,min ${f(ex.published.qc)}`;
                      })()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
