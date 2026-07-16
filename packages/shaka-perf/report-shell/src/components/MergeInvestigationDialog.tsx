/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by the ShakaPerf
 * License in LICENSE.md.
 */

import { Dialog } from '../../../src/pipeline/stage-report-components';
import type {
  BisectCategory,
  BisectReportCommit,
  BisectReportMergeSourceCommit,
  BisectReportTarget,
} from '../types';

interface Props {
  commit: BisectReportCommit;
  targetsById: Record<string, BisectReportTarget>;
  open: boolean;
  onClose: () => void;
}

type NonCompleteStatus = Exclude<
  NonNullable<BisectReportCommit['mergeInvestigationStatus']>,
  'complete'
>;

const categories: BisectCategory[] = ['visreg', 'perf', 'accessibility'];
const categoryLabels = {
  visreg: 'visual',
  perf: 'performance',
  accessibility: 'accessibility',
} satisfies Record<BisectCategory, string>;

function nonCompleteStateCopy(status: NonCompleteStatus): string {
  switch (status) {
    case 'merge-uninvestigated': return 'Source attribution has not been run.';
    case 'running': return 'Source investigation is still running.';
    case 'failed': return 'Source investigation failed.';
    case 'octopus-unsupported':
      return 'Source attribution is unavailable for octopus merges.';
  }
}

function MergeRegressionList({
  targetIds,
  targetsById,
}: {
  targetIds: readonly string[];
  targetsById: Record<string, BisectReportTarget>;
}) {
  return (
    <div className="merge-regression-list">
      {categories.map((category) => {
        const targets = targetIds
          .map((targetId) => targetsById[targetId])
          .filter((target): target is BisectReportTarget => target?.category === category);
        if (targets.length === 0) return null;
        return (
          <section key={category} className="merge-regression-group" data-category={category}>
            <h4>{categoryLabels[category]}</h4>
            <ul>
              {targets.map((target) => (
                <li key={target.id} data-target-id={target.id}>
                  <strong>{target.testName}</strong>
                  {target.viewport ? <span>{target.viewport}</span> : null}
                  <span>{target.subject}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function MergeSourceCommitRow({
  sourceCommit,
  targetsById,
  showAttribution,
}: {
  sourceCommit: BisectReportMergeSourceCommit;
  targetsById: Record<string, BisectReportTarget>;
  showAttribution: boolean;
}) {
  const responsible = showAttribution && sourceCommit.targetIds.length > 0;
  return (
    <li
      className="merge-source-commit"
      data-merge-source-sha={sourceCommit.sha}
      data-merge-source-result={responsible ? 'responsible' : 'clear'}
    >
      <header>
        <code>{sourceCommit.sha.slice(0, 7)}</code>
        <strong>{sourceCommit.subject}</strong>
        {sourceCommit.isMerge ? (
          <span className="merge-source-commit__merge">nested merge</span>
        ) : null}
        <span className="merge-source-commit__measurement">
          {sourceCommit.measured ? 'measured' : 'not measured'}
        </span>
      </header>
      {responsible ? (
        <MergeRegressionList targetIds={sourceCommit.targetIds} targetsById={targetsById} />
      ) : null}
    </li>
  );
}

export function MergeInvestigationDialog({ commit, targetsById, open, onClose }: Props) {
  const investigation = commit.mergeInvestigation;
  const status = investigation?.status
    ?? commit.mergeInvestigationStatus
    ?? 'merge-uninvestigated';
  const complete = status === 'complete';
  const sourceCount = complete
    ? (investigation?.sourceCommits ?? [])
      .reduce((sum, sourceCommit) => sum + sourceCommit.targetIds.length, 0)
    : 0;
  const mergeCount = complete ? investigation?.mergeIntroducedTargetIds.length ?? 0 : 0;
  const range = investigation?.mergeBase && investigation.secondParent
    ? `${investigation.mergeBase.slice(0, 7)} → ${investigation.secondParent.slice(0, 7)}`
    : 'unavailable';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={(
        <span className="ui-dialog__title-text">
          merge investigation · {commit.sha.slice(0, 7)}
        </span>
      )}
      meta={(
        <dl className="ui-dialog__meta">
          <div><dt>status</dt><dd>{status}</dd></div>
          <div><dt>source range</dt><dd>{range}</dd></div>
          <div><dt>attribution</dt><dd>{sourceCount} source · {mergeCount} merge</dd></div>
        </dl>
      )}
    >
      <div className="merge-investigation-dialog" data-bisect-merge-dialog={commit.sha}>
        {!complete ? (
          <div className="merge-investigation-dialog__state">
            <strong>{nonCompleteStateCopy(status)}</strong>
            {status === 'failed' && investigation?.failure ? (
              <p>{investigation.failure}</p>
            ) : null}
          </div>
        ) : null}
        {(investigation?.sourceCommits.length ?? 0) > 0 ? (
          <ol className="merge-source-trace">
            {investigation?.sourceCommits.map((sourceCommit) => (
              <MergeSourceCommitRow
                key={sourceCommit.sha}
                sourceCommit={sourceCommit}
                targetsById={targetsById}
                showAttribution={complete}
              />
            ))}
          </ol>
        ) : null}
        {complete && mergeCount > 0 ? (
          <section className="merge-introduced-panel">
            <h3>introduced by merge</h3>
            <MergeRegressionList
              targetIds={investigation?.mergeIntroducedTargetIds ?? []}
              targetsById={targetsById}
            />
          </section>
        ) : null}
        {complete && sourceCount === 0 && mergeCount === 0 ? (
          <p className="merge-investigation-dialog__empty">No attributable source regressions.</p>
        ) : null}
      </div>
    </Dialog>
  );
}
