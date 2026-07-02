/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PipelineReport } from '../pipeline/pipeline';
import type { ReportMeta, TestResult } from '../pipeline/report';
import type { StageArtifactTestMeta } from '../pipeline/stage-report-components';

function renderHeaderUrls(meta: ReportMeta) {
  return (
    <>
      <div>
        <dt>control</dt>
        <dd>{meta.controlUrl}</dd>
      </div>
      <div>
        <dt>experiment</dt>
        <dd>{meta.experimentUrl}</dd>
      </div>
    </>
  );
}

function renderTestCardUrls(test: TestResult) {
  return (
    <>
      <div>
        <dt>control</dt>
        <dd>
          <a href={test.controlUrl} target="_blank" rel="noreferrer">
            {test.controlUrl}
          </a>
        </dd>
      </div>
      <div>
        <dt>experiment</dt>
        <dd>
          <a href={test.experimentUrl} target="_blank" rel="noreferrer">
            {test.experimentUrl}
          </a>
        </dd>
      </div>
    </>
  );
}

function renderDialogMetaUrls(test: StageArtifactTestMeta) {
  return (
    <>
      <div>
        <dt>control</dt>
        <dd className="ui-dialog__meta-break">
          <a href={test.controlUrl} target="_blank" rel="noreferrer">
            {test.controlUrl}
          </a>
        </dd>
      </div>
      <div>
        <dt>experiment</dt>
        <dd className="ui-dialog__meta-break">
          <a href={test.experimentUrl} target="_blank" rel="noreferrer">
            {test.experimentUrl}
          </a>
        </dd>
      </div>
    </>
  );
}

export const comparePipelineReport: PipelineReport = {
  reportLabel: 'compare report',
  renderHeaderUrls,
  renderTestCardUrls,
  renderDialogMetaUrls,
};
