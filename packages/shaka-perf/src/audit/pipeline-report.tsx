/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PipelineReport } from '../pipeline/pipeline';
import type { ReportMeta, TestResult } from '../pipeline/report';
import type { StageArtifactTestMeta } from '../pipeline/stage-report-components';
import { troubleshootCommandFor } from '../troubleshoot/command';

function renderHeaderUrls(meta: ReportMeta) {
  return (
    <div>
      <dt>url</dt>
      <dd>{meta.experimentUrl}</dd>
    </div>
  );
}

function renderTestCardUrls(test: TestResult) {
  return (
    <div>
      <dt>url</dt>
      <dd>
        <a href={test.experimentUrl} target="_blank" rel="noreferrer">
          {test.experimentUrl}
        </a>
      </dd>
    </div>
  );
}

function renderDialogMetaUrls(test: StageArtifactTestMeta) {
  return (
    <div>
      <dt>url</dt>
      <dd className="ui-dialog__meta-break">
        <a href={test.experimentUrl} target="_blank" rel="noreferrer">
          {test.experimentUrl}
        </a>
      </dd>
    </div>
  );
}

export const auditPipelineReport: PipelineReport = {
  reportLabel: 'audit report',
  renderHeaderUrls,
  renderTestCardUrls,
  renderDialogMetaUrls,
  troubleshootCommand: troubleshootCommandFor,
};
