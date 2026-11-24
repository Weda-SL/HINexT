import { useEffect, useRef, useState } from 'react';

interface Props {
  kind: 'undo' | 'redo';
  /** Action labels, nearest first (for undo: most recent change first) */
  labels: string[];
  /** Undo/redo exactly one step */
  onOne: () => void;
  /** Undo/redo `count` steps at once */
  onMany: (count: number) => void;
}

/**
 * Split button: the arrow undoes/redoes one step; the small ▾ opens the list of
 * recorded steps so several can be undone/redone at once.
 */
export function HistoryButton({ kind, labels, onOne, onMany }: Props) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const verb = kind === 'undo' ? 'Undo' : 'Redo';
  const disabled = labels.length === 0;

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
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const oneLabel = disabled ? `Nothing to ${kind}` : `${verb}: ${labels[0]}`;
  const n = hover + 1;

  return (
    <div className="menu-root split" ref={root}>
      <button className="btn ghost icon-btn split-main" disabled={disabled} onClick={onOne} title={oneLabel} aria-label={oneLabel}>
        {kind === 'undo' ? '↶' : '↷'}
      </button>
      <button
        className="btn ghost split-caret"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${verb} several steps`}
        title={`${verb} several steps`}
        onClick={() => {
          setHover(-1);
          setOpen((o) => !o);
        }}
      >
        ▾
      </button>
      {open && (
        <div className="menu history-menu" role="menu" onPointerLeave={() => setHover(-1)}>
          <div className="menu-heading">{kind === 'undo' ? 'Undo back to…' : 'Redo up to…'}</div>
          <div className="history-list">
            {labels.map((label, i) => (
              <button
                key={i}
                role="menuitem"
                className={`menu-item history-item ${i <= hover ? 'picked' : ''}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={() => {
                  setOpen(false);
                  onMany(i + 1);
                }}
              >
                <span className="menu-title">{label}</span>
              </button>
            ))}
          </div>
          <div className="history-foot">
            {n > 0 ? `${verb} ${n} ${n === 1 ? 'step' : 'steps'}` : `${labels.length} ${labels.length === 1 ? 'step' : 'steps'} recorded`}
          </div>
        </div>
      )}
    </div>
  );
}
