/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Fragment } from 'react';
import { selectionTargetIds, type BisectSelection } from '../bisect-selection';
import type { BisectReportModel, BisectReportTarget } from '../types';

interface Props {
  model: BisectReportModel;
  selection: BisectSelection;
}

interface TestGroup {
  id: string;
  testName: string;
  testFile: string;
  targets: BisectReportTarget[];
}

interface ComparisonValue {
  items: readonly {
    label: string;
    value: string;
  }[];
}

interface PerfComparisonValue {
  control: string;
  experiment: string;
  delta: string;
  percent: string;
  pValue: string;
}

const categoryOrder: BisectReportTarget['category'][] = [
  'visreg',
  'perf',
  'accessibility',
];

function selectionTitle(selection: BisectSelection): string {
  if (selection.kind === 'all') return 'Regression tests';
  if (selection.kind === 'commit') return `Commit ${selection.sha.slice(0, 7)}`;
  if (selection.kind === 'unresolved') return 'Unresolved targets';
  return 'Invalid targets';
}

function emptyMessage(selection: BisectSelection): string {
  if (selection.kind === 'commit') return 'No regressions begin at this commit.';
  if (selection.kind === 'unresolved') return 'No unresolved regression targets.';
  if (selection.kind === 'invalid') return 'No invalid regression targets.';
  return 'No regression targets were discovered.';
}

function categoryLabel(target: Pick<BisectReportTarget, 'category'>): string {
  if (target.category === 'visreg') return 'visual';
  if (target.category === 'perf') return 'performance';
  return 'accessibility';
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function groupTargets(targets: readonly BisectReportTarget[]): TestGroup[] {
  const groups = new Map<string, TestGroup>();
  for (const target of targets) {
    const fallbackId = `${target.testFile.replaceAll('\\', '/')}::${target.testName}`;
    const id = target.testId ?? fallbackId;
    const group = groups.get(id);
    if (group) {
      group.targets.push(target);
    } else {
      groups.set(id, {
        id,
        testName: target.testName,
        testFile: target.testFile,
        targets: [target],
      });
    }
  }
  return [...groups.values()];
}

function value(
  values: Record<string, string | number | boolean | null>,
  key: string,
): string | number | boolean | null | undefined {
  return values[key];
}

function display(valueToFormat: string | number | boolean | null | undefined): string {
  if (valueToFormat == null) return 'not recorded';
  return typeof valueToFormat === 'number'
    ? valueToFormat.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : String(valueToFormat);
}

function formatPValue(pValue: number): string {
  if (!Number.isFinite(pValue)) return String(pValue);
  if (pValue === 0) return '0';
  if (Math.abs(pValue) < 1e-6) return pValue.toExponential(1);
  return pValue.toFixed(6).replace(/\.?0+$/, '');
}

function signedDifference(experiment: unknown, control: unknown, label: string): string {
  if (typeof experiment !== 'number' || typeof control !== 'number') return 'not recorded';
  const difference = experiment - control;
  const prefix = difference > 0 ? '+' : '';
  return `${prefix}${difference.toLocaleString('en-US')} ${label}`;
}

function accessibilityCount(
  values: Record<string, string | number | boolean | null>,
  side: 'control' | 'experiment',
): string {
  const violations = value(values, `${side}ViolationCount`);
  const nodes = value(values, `${side}NodeCount`);
  const violationText = typeof violations === 'number'
    ? pluralize(violations, 'violation')
    : 'violations not recorded';
  const nodeText = typeof nodes === 'number' ? pluralize(nodes, 'node') : 'nodes not recorded';
  return `${violationText} · ${nodeText}`;
}

function comparisonValue(target: BisectReportTarget): ComparisonValue | null {
  const values = target.badRefObservation?.values;
  if (!values) return null;

  if (value(values, 'controlDisplay') != null || value(values, 'experimentDisplay') != null) {
    const delta = display(value(values, 'deltaDisplay'));
    const percent = value(values, 'percentDisplay');
    return {
      items: [
        { label: 'Control', value: display(value(values, 'controlDisplay')) },
        { label: 'Experiment', value: display(value(values, 'experimentDisplay')) },
        {
          label: 'Change',
          value: percent == null || percent === '—' ? delta : `${delta} · ${display(percent)}`,
        },
      ],
    };
  }

  if (value(values, 'controlViolationCount') != null) {
    const violationChange = signedDifference(
      value(values, 'experimentViolationCount'),
      value(values, 'controlViolationCount'),
      'violations',
    );
    const nodeChange = signedDifference(
      value(values, 'experimentNodeCount'),
      value(values, 'controlNodeCount'),
      'nodes',
    );
    return {
      items: [
        { label: 'Control', value: accessibilityCount(values, 'control') },
        { label: 'Experiment', value: accessibilityCount(values, 'experiment') },
        { label: 'Change', value: `${violationChange} · ${nodeChange}` },
      ],
    };
  }

  if (value(values, 'misMatchPercentage') != null) {
    const mismatch = display(value(values, 'misMatchPercentage'));
    const pixels = display(value(values, 'diffPixels'));
    const threshold = value(values, 'threshold');
    return {
      items: [
        { label: 'Mismatch', value: `${mismatch}%` },
        { label: 'Changed pixels', value: pixels },
        {
          label: 'Threshold',
          value: threshold == null ? 'not recorded' : `${display(threshold)}%`,
        },
      ],
    };
  }

  if (value(values, 'controlValue') != null || value(values, 'experimentValue') != null) {
    return {
      items: [
        { label: 'Control', value: display(value(values, 'controlValue')) },
        { label: 'Experiment', value: display(value(values, 'experimentValue')) },
        { label: 'Change', value: display(value(values, 'deltaValue')) },
      ],
    };
  }

  return null;
}

function perfComparisonValue(target: BisectReportTarget): PerfComparisonValue {
  const values = target.badRefObservation?.values ?? {};
  const pValue = value(values, 'pValue');
  return {
    control: display(value(values, 'controlDisplay')),
    experiment: display(value(values, 'experimentDisplay')),
    delta: display(value(values, 'deltaDisplay')),
    percent: display(value(values, 'percentDisplay')),
    pValue: typeof pValue === 'number' ? formatPValue(pValue) : 'not recorded',
  };
}

function TargetDetails({ target }: { target: BisectReportTarget }) {
  return (
    <>
      {target.mainlineIsMerge || target.mergeResult ? (
        <dl className="bisect-target__comparison bisect-target__merge-details">
          {target.mainlineIsMerge && target.mainlineFirstBadSha ? (
            <div>
              <dt>mainline first bad</dt>
              <dd>
                <code>{target.mainlineFirstBadSha.slice(0, 7)}</code>
                {' · merge'}
              </dd>
            </div>
          ) : null}
          {target.mergeResult ? (
            <div>
              <dt>merge source</dt>
              <dd>
                {target.mergeSourceSha ? <code>{target.mergeSourceSha.slice(0, 7)}</code> : null}
                {target.mergeSourceSha ? ' · ' : ''}
                {target.mergeResult.replaceAll('-', ' ')}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {target.invalidReason ? (
        <p className="bisect-target__invalid-reason">
          <strong>Invalid:</strong> {target.invalidReason}
        </p>
      ) : null}
    </>
  );
}

function PerfTargetTable({ targets }: { targets: readonly BisectReportTarget[] }) {
  return (
    <div className="bisect-perf-table-wrap">
      <table className="bisect-perf-table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Control</th>
            <th>Experiment</th>
            <th>Delta</th>
            <th>%Delta</th>
            <th>p</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((target) => {
            const comparison = perfComparisonValue(target);
            const hasDetails = target.mainlineIsMerge || target.mergeResult || target.invalidReason;
            return (
              <Fragment key={target.id}>
                <tr data-category={target.category} data-target-id={target.id}>
                  <td className="bisect-perf-table__metric">
                    <strong>{target.subject}</strong>
                    <span>{target.viewport}</span>
                  </td>
                  <td>{comparison.control}</td>
                  <td>{comparison.experiment}</td>
                  <td className="bisect-perf-table__delta">{comparison.delta}</td>
                  <td className="bisect-perf-table__delta">{comparison.percent}</td>
                  <td>{comparison.pValue}</td>
                </tr>
                {hasDetails ? (
                  <tr className="bisect-perf-table__details">
                    <td colSpan={6}><TargetDetails target={target} /></td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TargetRow({ target }: { target: BisectReportTarget }) {
  const comparison = comparisonValue(target);

  return (
    <li className="bisect-target" data-category={target.category} data-target-id={target.id}>
      <header className="bisect-target__header">
        <h4 className="bisect-target__subject">{target.subject}</h4>
        <span className="bisect-target__viewport">{target.viewport}</span>
      </header>
      {comparison ? (
        <dl className="bisect-target__comparison">
          {comparison.items.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <TargetDetails target={target} />
    </li>
  );
}

function TestGroupCard({ group }: { group: TestGroup }) {
  return (
    <li className="bisect-test-group" data-bisect-test-group={group.id}>
      <article>
        <header className="bisect-test-group__header">
          <div>
            <h3>{group.testName}</h3>
            <code>{group.testFile}</code>
          </div>
          <span>{pluralize(group.targets.length, 'regression target')}</span>
        </header>
        <div className="bisect-test-group__categories">
          {categoryOrder.map((category) => {
            const targets = group.targets.filter((target) => target.category === category);
            if (targets.length === 0) return null;
            return (
              <section key={category} className="bisect-target-category" data-category={category}>
                <header className="bisect-target-category__header">
                  <span className={`bisect-target__category bisect-target__category--${category}`}>
                    {categoryLabel({ category })}
                  </span>
                  <span>{pluralize(targets.length, 'target')}</span>
                </header>
                {category === 'perf' ? (
                  <PerfTargetTable targets={targets} />
                ) : (
                  <ul className="bisect-target-category__list">
                    {targets.map((target) => <TargetRow key={target.id} target={target} />)}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </article>
    </li>
  );
}

export function BisectSelectionSummary({ model, selection }: Props) {
  const targetIds = selectionTargetIds(model, selection);
  const targets = [...targetIds]
    .map((targetId) => model.targetsById[targetId])
    .filter((target): target is BisectReportTarget => target != null);
  const groups = groupTargets(targets);

  return (
    <section
      className="bisect-selection-summary"
      data-selection-kind={selection.kind}
      aria-labelledby="bisect-selection-title"
    >
      <header className="bisect-selection-summary__header">
        <h2 id="bisect-selection-title">{selectionTitle(selection)}</h2>
        <span
          className="bisect-selection-summary__status"
          aria-live="polite"
          aria-atomic="true"
        >
          {pluralize(targets.length, 'selected target')}
          {groups.length > 0 ? ` across ${pluralize(groups.length, 'test')}` : ''}
        </span>
      </header>
      {targets.length === 0 ? (
        <p className="bisect-selection-summary__empty">{emptyMessage(selection)}</p>
      ) : (
        <ul className="bisect-test-group-list">
          {groups.map((group) => <TestGroupCard key={group.id} group={group} />)}
        </ul>
      )}
    </section>
  );
}
