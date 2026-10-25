/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { FullReportOnly } from '../pipeline/report-mode';
import type { AuditPipelineConfig } from './pipeline';
import type { PipelineReport } from '../pipeline/pipeline';
import type { ReportMeta } from '../pipeline/report';
import { troubleshootCommandFor } from '../troubleshoot/command';

function renderHeaderUrls(meta: ReportMeta) {
  return (
    <>
      <div>
        <dt>url</dt>
        <dd>{meta.experimentUrl}</dd>
      </div>
      {(meta.pipelineConfig as AuditPipelineConfig)?.coverageReport && (
        <FullReportOnly>
          <div>
            <dt>executed-code coverage</dt>
            <dd><a href="coverage/index.html" target="_blank" rel="noreferrer">All Tests ↗</a></dd>
          </div>
        </FullReportOnly>
      )}
    </>
  );
}

export const auditPipelineReport: PipelineReport = {
  reportLabel: 'audit report',
  renderHeaderUrls,
  testTargets(test) {
    return [{ side: 'experiment', label: 'url', href: test.experimentUrl }];
  },
  troubleshootCommand: troubleshootCommandFor,
};
