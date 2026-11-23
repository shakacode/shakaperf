/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { VisregArtifact } from '../visreg';

type VisualComparisonFields = {
  selector: string;
  mismatch: string;
  'visual comparisons'?: string;
};

function comparisonCount(artifact: VisregArtifact): string | undefined {
  const { visualComparisonCount, visualComparisonLimit, savedByRetries } = artifact;
  if (visualComparisonCount === undefined) return undefined;

  const count = visualComparisonLimit === undefined
    ? String(visualComparisonCount)
    : `${visualComparisonCount}/${visualComparisonLimit}`;
  return savedByRetries ? `${count} · matched on retry` : count;
}

export function visualComparisonFields(artifact: VisregArtifact): VisualComparisonFields {
  const fields: VisualComparisonFields = {
    selector: artifact.selector,
    mismatch: `${artifact.misMatchPercentage.toFixed(2)}%`,
  };
  const count = comparisonCount(artifact);
  if (count !== undefined) fields['visual comparisons'] = count;
  return fields;
}
