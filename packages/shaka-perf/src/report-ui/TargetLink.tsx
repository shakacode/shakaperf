/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReactNode } from 'react';
import type { TestTarget } from '../pipeline/pipeline';

export function TargetLink({ target, children, className }: { target: TestTarget; children?: ReactNode; className?: string }) {
  return (
    <div>
      <dt>{target.label}</dt>
      <dd className={className}>
        <a href={target.href} target="_blank" rel="noreferrer">
          {target.href}
        </a>
        {children}
      </dd>
    </div>
  );
}
