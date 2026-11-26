/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementMetadata } from '../../pipeline/run-metadata';

export function CommitDetails({ commit }: { commit: Pick<NonNullable<MeasurementMetadata['targets'][number]['commit']>, 'sha' | 'message'> }) {
  const [subject = '', ...body] = commit.message.split('\n');
  const heading = (
    <>
      <code title={commit.sha}>{commit.sha.slice(0, 8)}</code>
      <span>{subject || (body.join('\n').trim() ? 'Commit message' : 'Empty commit message')}</span>
    </>
  );
  if (!body.join('\n').trim())
    return (
      <div className="run-details__commit">
        <div className="run-details__commit-heading">{heading}</div>
      </div>
    );
  return (
    <details className="run-details__commit">
      <summary>{heading}</summary>
      <div className="run-details__commit-body">
        <pre>{body.join('\n')}</pre>
      </div>
    </details>
  );
}
