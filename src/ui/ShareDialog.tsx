import { useEffect, useRef, useState } from 'react';
import { SHARE_LIMIT } from '../state/share';

interface Props {
  url: string;
  payloadLength: number;
  onSaveFile: () => void;
  onClose: () => void;
}

/** Shows the share link with a copy button; too-long links point to the .pinch file instead. */
export function ShareDialog({ url, payloadLength, onSaveFile, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const tooLong = payloadLength > SHARE_LIMIT;

  useEffect(() => {
    field.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      field.current?.select();
      document.execCommand?.('copy');
      setCopied(true);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <header className="modal-head">
          <div>
            <h2 id="share-title">Share link</h2>
            <p className="muted">
              The whole project is packed into the link itself, after the #. Nothing is uploaded: whoever opens the link gets their own copy, and later changes are not shared.
            </p>
          </div>
          <button className="panel-close" aria-label="Close" title="Close" onClick={onClose}>×</button>
        </header>
        {tooLong ? (
          <p className="modal-status bad">
            This project is too large for a reliable link ({payloadLength.toLocaleString('en')} characters; the limit is {SHARE_LIMIT.toLocaleString('en')}). Save it as a .pinch file and send the file instead.
          </p>
        ) : (
          <div className="share-row">
            <input ref={field} className="share-url" readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
            <button className="btn primary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
          </div>
        )}
        <footer className="modal-foot">
          <button className="btn ghost" onClick={onSaveFile}>Save as a .pinch file instead</button>
          <button className="btn" onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
