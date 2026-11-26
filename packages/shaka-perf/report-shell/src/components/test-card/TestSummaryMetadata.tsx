/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReportOutcome, TestResult } from '../../types';
import { pipelineTroubleshootCommands } from '../../../../src/pipeline/pipeline-artifacts';
import {
  type TestMetadataDisplayOptions,
  TestMetadataSection,
  useTestCard,
} from '../../../../src/report-ui/metadata';

function latestMeasuredExecution(outcomes: readonly ReportOutcome[]) {
  let latest: ReportOutcome['executionDetails'] | undefined;
  for (const { executionDetails } of outcomes) {
    if (executionDetails.measurementMetadata && (!latest || executionDetails.runId > latest.runId)) {
      latest = executionDetails;
    }
  }
  return latest;
}

export function TestSummaryMetadata({ test, ...layout }: TestMetadataDisplayOptions & { test: TestResult }) {
  const { meta } = useTestCard();
  const { outcomes, measuredAt } = test;
  const viewports = [...new Set(outcomes.map(outcome => outcome.executionDetails.viewport.label))];
  return (
    <TestMetadataSection
      {...layout}
      measuredAt={measuredAt}
      executionDetails={latestMeasuredExecution(outcomes)}
      troubleshoot={pipelineTroubleshootCommands(meta, test.name, viewports)}
    />
  );
}
