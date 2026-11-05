/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useId, useLayoutEffect, useRef } from 'react';
import { attachReportTooltip } from './report-tooltip-controller';

export function TooltipLabel({ label, explanation, helpOnly = false }: {
  label: string;
  explanation: string;
  helpOnly?: boolean;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (button.current) return attachReportTooltip(button.current, explanation);
  }, [explanation]);
  return (
    <button
      id={id}
      ref={button}
      type="button"
      className="report-tooltip__trigger"
      aria-label={`${label}: explanation`}
      data-tooltip={explanation}
    >
      {helpOnly ? null : `${label} `}<span className="report-tooltip__help" aria-hidden="true">?</span>
    </button>
  );
}
