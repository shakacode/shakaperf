import type { ReactNode } from 'react';
import type { TestResult } from '../types';

/**
 * Shared dialog metadata block — used by both visreg and perf dialogs so the
 * TEST / FILE / CONTROL / EXPERIMENT fields line up in identical positions
 * regardless of which artifact opened the dialog. `extra` lets callers append
 * artifact-specific rows (viewport/selector/mismatch for visreg, artifact
 * label for perf) without duplicating the shared scaffolding.
 */
export function TestMeta({
  test,
  extra,
}: {
  test: TestResult;
  extra?: ReactNode;
}) {
  return (
    <dl className="ui-dialog__meta">
      <div>
        <dt>test</dt>
        <dd>{test.name}</dd>
      </div>
      <div>
        <dt>file</dt>
        <dd>{test.filePath}</dd>
      </div>
      {extra}
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
    </dl>
  );
}
