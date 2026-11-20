/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { TestTarget } from '../pipeline/pipeline';
import type { MeasuredCommit } from '../pipeline/run-metadata';
import { CommitDetails } from './CommitDetails';

export function TargetLink({ target, commit }: {
  target: TestTarget;
  commit?: MeasuredCommit | null;
}) {
  return (
    <div>
      <dt>{target.label}</dt>
      <dd>
        <a href={target.href} target="_blank" rel="noreferrer">
          {target.href}
        </a>
        {commit ? (
          <div className="card__target-commits">
            <CommitDetails commit={commit} />
          </div>
        ) : null}
      </dd>
    </div>
  );
}
