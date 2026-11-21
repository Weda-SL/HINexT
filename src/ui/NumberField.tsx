import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Value in display units; NaN/undefined shows as blank */
  value: number | null | undefined;
  /** Called with the parsed number (NaN when cleared) when the user commits */
  onCommit: (v: number) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  /** Show this many decimals at most when not editing */
  dp?: number;
  disabled?: boolean;
  invalid?: boolean;
}

function show(v: number | null | undefined, dp: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  return String(+v.toFixed(dp));
}

/**
 * Text-based numeric input: keeps what the user types while editing and
 * commits on blur or Enter, so each field edit is one named action.
 */
export function NumberField({ value, onCommit, placeholder, ariaLabel, className, dp = 6, disabled, invalid }: Props) {
  const [text, setText] = useState(show(value, dp));
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing) setText(show(value, dp));
  }, [value, dp, editing]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setText(show(value, dp));
      return;
    }
    const t = text.trim().replace(',', '.').replace('−', '-');
    const v = t === '' ? NaN : Number(t);
    if (t !== '' && Number.isNaN(v)) {
      setText(show(value, dp));
      return;
    }
    const old = value ?? NaN;
    if (Number.isNaN(v) && Number.isNaN(old)) return;
    if (v === old) return;
    onCommit(v);
  };

  return (
    <input
      className={`num ${className ?? ''} ${invalid ? 'invalid' : ''}`}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      disabled={disabled}
      onFocus={(e) => {
        setEditing(true);
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
