/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReportOutcome, TestResult } from '../types';
import { pipelineTroubleshootCommands } from '../../../src/pipeline/pipeline-artifacts';
import { MetadataPanel, type PanelLayout } from '../../../src/report-ui/MetadataPanel';
import { TargetLink } from '../../../src/report-ui/TargetLink';
import { useTestCard } from '../../../src/report-ui/test-card-context';
import { RunCommits } from './RunDetails';

function latestMeasuredExecution(outcomes: readonly ReportOutcome[]) {
  let latest: ReportOutcome['executionDetails'] | undefined;
  for (const { executionDetails } of outcomes) {
    if (executionDetails.measurementMetadata && (!latest || executionDetails.runId > latest.runId)) {
      latest = executionDetails;
    }
  }
  return latest;
}

export function TestSummaryMetadata({ test, ...layout }: PanelLayout & { test: TestResult }) {
  const { meta, targets } = useTestCard();
  const { outcomes, measuredAt } = test;
  const viewports = [...new Set(outcomes.map(outcome => outcome.executionDetails.viewport.label))];
  return (
    <MetadataPanel
      {...layout}
      measuredAt={measuredAt}
      executionDetails={latestMeasuredExecution(outcomes)}
      troubleshoot={pipelineTroubleshootCommands(meta, test.name, viewports)}
      targetLinks={targets.map(target => (
        <TargetLink key={target.side} target={target}>
          <RunCommits outcomes={outcomes} side={target.side} />
        </TargetLink>
      ))}
    />
  );
}
