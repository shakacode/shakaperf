/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { PipelineReport } from '../pipeline/pipeline';
import type { ReportMeta } from '../pipeline/report';
import { troubleshootCommandFor } from '../troubleshoot/command';

function renderHeaderUrls(meta: ReportMeta) {
  return (
    <div>
      <dt>url</dt>
      <dd>{meta.experimentUrl}</dd>
    </div>
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
