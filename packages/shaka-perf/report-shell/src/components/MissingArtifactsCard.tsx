/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ReportMeta, TestResult } from '../types';

export function MissingArtifactsCard({
  meta,
  tests,
}: {
  meta: ReportMeta;
  tests: TestResult[];
}) {
  if (tests.length === 0) return null;
  const pipelineName = meta.pipelineName ?? 'compare';
  return (
    <article className="card card--missing-artifacts" data-chip-color="gray">
      <div className="card__head">
        <div>
          <h3 className="card__title">no artifacts yet</h3>
        </div>
      </div>
      <div className="missing-artifacts__summary">
        {tests.length} test{tests.length === 1 ? '' : 's'} missing on-disk measurements —
        re-run `shaka-perf {pipelineName}` (or ship the shard that measures them)
      </div>
      <ul className="missing-artifacts__list">
        {tests.map((t) => (
          <li key={t.id} className="missing-artifacts__item">
            <span className="missing-artifacts__name">{t.name}</span>
            <span className="missing-artifacts__path">{t.filePath}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
