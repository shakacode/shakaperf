/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReactNode } from 'react';

export function StageArtifact({ children }: { children: ReactNode }) {
  return (
    <div className="stage-artifact__content">
      {children}
    </div>
  );
}
