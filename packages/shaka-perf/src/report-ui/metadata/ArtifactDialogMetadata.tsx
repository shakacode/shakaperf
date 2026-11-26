/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ExecutionDetails } from '../../pipeline/outcome';
import { pipelineTroubleshootCommands } from '../../pipeline/pipeline-artifacts';
import { ArtifactMetadataFields } from './ArtifactMetadataFields';
import { TestMetadataSection } from './TestMetadataSection';
import { useTestCard } from './TestCardProvider';

export function ArtifactDialogMetadata({ executionDetails }: {
  executionDetails: ExecutionDetails;
}) {
  const { meta, test } = useTestCard();
  const measurement = executionDetails.measurementMetadata;
  return (
    <TestMetadataSection
      variant="dialog"
      defaultExpanded
      executionDetails={executionDetails}
      measuredAt={measurement?.measuredAt ? Date.parse(measurement.measuredAt) : null}
      troubleshoot={pipelineTroubleshootCommands(meta, test.name, [executionDetails.viewport.label])}
    >
      <ArtifactMetadataFields executionDetails={executionDetails} />
    </TestMetadataSection>
  );
}
