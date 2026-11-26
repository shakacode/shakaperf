/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ExecutionDetails } from '../../pipeline/outcome';

export function ArtifactMetadataFields({ executionDetails }: { executionDetails: ExecutionDetails }) {
  const fields = executionDetails.stageMetadata;
  const showRetries =
    executionDetails.recoveredAfterRetries || (executionDetails.taskRetries ?? 0) > 0;
  return (
    <>
      {showRetries ? (
        <dl className="ui-dialog__meta">
          <div>
            <dt>error retries</dt>
            <dd>
              {executionDetails.taskRetries ?? '?'}/{executionDetails.taskRetryLimit ?? '?'}
              {executionDetails.recoveredAfterRetries ? ' · recovered' : ''}
            </dd>
          </div>
        </dl>
      ) : null}
      <MetadataRows fields={fields} />
    </>
  );
}

export function MetadataRows({ fields }: { fields?: Readonly<Record<string, string>> }) {
  if (!fields || Object.keys(fields).length === 0) return null;
  return (
    <dl className="ui-dialog__meta">
      {Object.entries(fields).map(([label, value]) => (
        <div key={label} className={value.length > 40 ? 'ui-dialog__meta-wide' : undefined}>
          <dt>{label}</dt>
          <dd className="ui-dialog__meta-break">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
