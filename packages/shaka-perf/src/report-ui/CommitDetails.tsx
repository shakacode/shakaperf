/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { MeasurementMetadata } from '../pipeline/run-metadata';

export function CommitDetails({ commit }: { commit: Pick<NonNullable<MeasurementMetadata['targets'][number]['commit']>, 'sha' | 'message'> }) {
  const [subject = '', ...bodyLines] = commit.message.split('\n');
  const body = bodyLines.join('\n');
  const hasBody = body.trim().length > 0;
  const title = subject || (hasBody ? 'Commit message' : 'Empty commit message');
  const heading = <>
    <code title={commit.sha}>{commit.sha.slice(0, 8)}</code>
    <span>{title}</span>
  </>;

  if (!hasBody) {
    return <div className="target-commit">
      <div className="target-commit__heading">{heading}</div>
    </div>;
  }
  return (
    <details className="target-commit">
      <summary>{heading}</summary>
      <div className="target-commit__body">
        <pre>{body}</pre>
      </div>
    </details>
  );
}
