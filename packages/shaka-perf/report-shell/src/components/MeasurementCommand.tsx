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
  const fieldLabel = label ?? (compact && !autoSize ? 'Latest command' : 'Measurement command');
  const classes = ['measurement-command'];
  if (compact) classes.push('measurement-command--compact');
  if (autoSize) classes.push('measurement-command--auto-size');

  function selectCommand() {
    if (!code.current) {
      field.current?.focus();
      field.current?.select();
      return;
    }
    code.current.focus();
    const range = document.createRange();
    range.selectNodeContents(code.current);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus('Copied');
    } catch {
      selectCommand();
      setStatus('Command selected — copy manually');
    }
  }

  return (
    <div className={classes.join(' ')}>
      {autoSize ? (
        <pre aria-label={fieldLabel} ref={code} tabIndex={0}><code>{command}</code></pre>
      ) : (
        <textarea aria-label={fieldLabel} ref={field} value={command} readOnly rows={compact ? 1 : 2} />
      )}
      <button type="button" onClick={copy} aria-label="Copy command" title={status}>
        {compact ? 'Copy' : status}
      </button>
      {compact || autoSize ? (
        <span className="measurement-command__status" role="status">
          {status === 'Copy command' ? '' : status}
        </span>
      ) : null}
    </div>
  );
}
