import { useEffect, useRef, useState } from 'react';
import { EXAMPLES, type Example } from '../examples';

interface Props {
  onNew: () => void;
  onFile: () => void;
  onExample: (ex: Example) => void;
}

/** "Open" button with a menu: a new blank project, a file from this computer, or a built-in example. */
export function OpenMenu({ onNew, onFile, onExample }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
      <button className="btn ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Open <span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" className="menu-item" onClick={() => pick(onNew)}>
            <span className="menu-title">New blank project</span>
            <span className="menu-sub">No streams; default steam and cooling water</span>
          </button>
          <button role="menuitem" className="menu-item" onClick={() => pick(onFile)}>
            <span className="menu-title">From a file on this computer…</span>
            <span className="menu-sub">.pinch project file</span>
          </button>
          <div className="menu-sep" />
          <div className="menu-heading">Examples</div>
          {EXAMPLES.map((ex) => (
            <button key={ex.key} role="menuitem" className="menu-item" onClick={() => pick(() => onExample(ex))}>
              <span className="menu-title">{ex.title}</span>
              <span className="menu-sub">
                ΔTmin {ex.published.dtMin} K · QH,min {ex.published.qh} kW · QC,min {ex.published.qc} kW
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
