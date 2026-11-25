/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useRef, useState } from 'react';

export function CopyableText({ text, label, copyLabel, prefix, singleRow = false }: {
  text: string;
  label: string;
  copyLabel: string;
  prefix?: string;
  singleRow?: boolean;
}) {
  const [status, setStatus] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const code = useRef<HTMLElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied');
    } catch {
      if (field.current) {
        field.current.focus();
        field.current.select();
      } else if (code.current) {
        pre.current?.focus();
        const range = document.createRange();
        range.selectNodeContents(code.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setStatus('Text selected — copy manually');
    }
  }

  return (
    <div className="copyable-text">
      {singleRow ? (
        <textarea aria-label={label} ref={field} value={text} readOnly rows={1} />
      ) : (
        <pre className="card__code" aria-label={label} ref={pre} tabIndex={0}>{prefix}<code ref={code}>{text}</code></pre>
      )}
      <button type="button" onClick={copy} aria-label={copyLabel} title={copyLabel}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M16 5V4a1 1 0 0 0-1-1H5a2 2 0 0 0-2 2v10a1 1 0 0 0 1 1h1" />
        </svg>
      </button>
      <span className="run-details__copy-status" role="status">{status}</span>
    </div>
  );
}
