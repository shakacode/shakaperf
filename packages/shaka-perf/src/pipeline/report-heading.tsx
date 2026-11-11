/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import type { ReactNode, Ref } from 'react';

export interface ReportHeadingProps {
  title: ReactNode;
  badge?: ReactNode;
  className?: string;
  level?: 4 | 5 | 6;
  disclosure?: {
    label: string;
    expanded: boolean;
    controls: string;
    buttonRef: Ref<HTMLButtonElement>;
    onToggle: () => void;
  };
}

export function ReportHeading({ title, badge, className = '', level = 4, disclosure }: ReportHeadingProps) {
  const Heading = level === 4 ? 'h4' : level === 5 ? 'h5' : 'h6';
  return (
    <Heading className={`report-heading ${className}`}>
      {disclosure ? (
        <button
          ref={disclosure.buttonRef}
          type="button"
          className="report-section__disclosure"
          aria-label={`${disclosure.label} visibility for all tests`}
          aria-controls={disclosure.controls}
          aria-expanded={disclosure.expanded}
          title="Collapse or expand this section across all tests"
          onClick={disclosure.onToggle}
        >
          <span aria-hidden="true">{disclosure.expanded ? '▾' : '▸'}</span>
          {title}
        </button>
      ) : title}
      {badge}
    </Heading>
  );
}
