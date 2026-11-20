/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { ExecutionDetails } from '../pipeline/outcome';
import { pipelineTroubleshootCommands } from '../pipeline/pipeline-artifacts';
import { ArtifactMetadataFields } from './ArtifactMetadataFields';
import { CommitDetails } from './CommitDetails';
import { MetadataPanel } from './MetadataPanel';
import { TargetLink } from './TargetLink';
import { useTestCard } from './test-card-context';

export function ArtifactMetadata({ executionDetails, fields }: {
  executionDetails: ExecutionDetails;
  fields?: Readonly<Record<string, string>>;
}) {
  const { meta, test, targets } = useTestCard();
  const measurement = executionDetails.measurementMetadata;
  return (
    <MetadataPanel
      variant="dialog"
      defaultExpanded
      executionDetails={executionDetails}
      measuredAt={measurement?.measuredAt ? Date.parse(measurement.measuredAt) : null}
      troubleshoot={pipelineTroubleshootCommands(meta, test.name, [executionDetails.viewport.label])}
      targetLinks={targets.map(target => {
        const saved = measurement?.targets.find(item => item.side === target.side);
        return (
          <TargetLink key={target.side} target={target}>
            <div className="card__target-commits">
              {saved && (saved.commit
                ? <CommitDetails commit={saved.commit} />
                : <p className="run-details__unavailable">Commit unavailable</p>)}
            </div>
          </TargetLink>
        );
      })}
    >
      <ArtifactMetadataFields executionDetails={executionDetails} fields={fields} />
    </MetadataPanel>
  );
}
