/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useRef, useState } from 'react';

export function MeasurementCommand({ command, compact = false, autoSize = false, label }: {
  command: string;
  compact?: boolean;
  autoSize?: boolean;
  label?: string;
}) {
  const [status, setStatus] = useState('Copy command');
  const field = useRef<HTMLTextAreaElement>(null);
  const code = useRef<HTMLPreElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus('Copied');
    } catch {
      if (code.current) {
        code.current.focus();
        const range = document.createRange();
        range.selectNodeContents(code.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else {
        field.current?.focus();
        field.current?.select();
      }
      setStatus('Command selected — copy manually');
    }
  }
  return (
    <div className={`measurement-command${compact ? ' measurement-command--compact' : ''}${autoSize ? ' measurement-command--auto-size' : ''}`}>
      {autoSize
        ? <pre aria-label={label ?? 'Measurement command'} ref={code} tabIndex={0}><code>{command}</code></pre>
        : <textarea aria-label={label ?? (compact ? 'Latest command' : 'Measurement command')} ref={field} value={command} readOnly rows={compact ? 1 : 2} />}
      <button type="button" onClick={copy} aria-label="Copy command" title={status}>{compact ? 'Copy' : status}</button>
      {compact || autoSize ? <span className="measurement-command__status" role="status">{status === 'Copy command' ? '' : status}</span> : null}
    </div>
  );
}

