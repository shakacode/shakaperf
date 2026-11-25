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

export const comparePipelineReport: PipelineReport = {
  reportLabel: 'compare report',
  renderHeaderUrls,
  testTargets(test) {
    return [
      { side: 'control', label: 'control', href: test.controlUrl },
      { side: 'experiment', label: 'experiment', href: test.experimentUrl },
    ];
  },
  troubleshootCommand: troubleshootCommandFor,
};
