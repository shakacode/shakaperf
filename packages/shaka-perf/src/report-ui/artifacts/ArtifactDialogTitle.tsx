/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReactNode } from 'react';
import { useTestCard } from '../metadata/TestCardProvider';

export function ArtifactDialogTitle({ children }: { children: ReactNode }) {
  const { test } = useTestCard();
  return (
    <span className="ui-dialog__title-text">
      {children} · {test.name}
    </span>
  );
}
