/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReactNode } from 'react';

export interface ReportHeadingProps {
  title: ReactNode;
  badge?: ReactNode;
  className?: string;
  level?: 4 | 5 | 6;
}

export function ReportHeading({ title, badge, className = '', level = 4 }: ReportHeadingProps) {
  const Heading = level === 4 ? 'h4' : level === 5 ? 'h5' : 'h6';
  return (
    <Heading className={`report-heading ${className}`}>
      {title}
      {badge}
    </Heading>
  );
}
