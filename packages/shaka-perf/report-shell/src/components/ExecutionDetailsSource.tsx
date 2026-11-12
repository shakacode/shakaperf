/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useEffect, useState } from 'react';
import type { ExecutionDetails } from '../../../src/pipeline/outcome';
import type { ReportOutcome } from '../types';

interface ExecutionDetailsSourceProps {
  outcomes: readonly ReportOutcome[];
  executionDetails?: ExecutionDetails;
}

interface SourceSnapshot {
  href: string;
  label: string;
}

export function ExecutionDetailsSource({ outcomes, executionDetails }: ExecutionDetailsSourceProps) {
  if (executionDetails) {
    const href = executionDetails.testSourceHref;
    return <SourceText key={href} href={href} />;
  }

  return <TestSourceSelection outcomes={outcomes} />;
}

function availableSourceSnapshots(outcomes: readonly ReportOutcome[]): SourceSnapshot[] {
  const newestFirst = [...outcomes].sort((a, b) =>
    b.executionDetails.runId.localeCompare(a.executionDetails.runId));
  const snapshots = new Map<string, SourceSnapshot>();

  for (const { stage, executionDetails } of newestFirst) {
    const { testSourceHref, viewport, runId } = executionDetails;
    if (testSourceHref === null || snapshots.has(testSourceHref)) continue;

    snapshots.set(testSourceHref, {
      href: testSourceHref,
      label: `${stage} · ${viewport.label} · ${runId}`,
    });
  }

  return [...snapshots.values()];
}

function TestSourceSelection({ outcomes }: { outcomes: readonly ReportOutcome[] }) {
  const [selectedHref, setSelectedHref] = useState<string | null>(null);
  const snapshots = availableSourceSnapshots(outcomes);
  const selectedSnapshot = snapshots.find(snapshot => snapshot.href === selectedHref) ?? snapshots[0];
  const href = selectedSnapshot?.href ?? null;

  return (
    <>
      {snapshots.length > 1 && (
        <label>
          Source snapshot{' '}
          <select
            aria-label="Source snapshot"
            value={href ?? ''}
            onChange={event => setSelectedHref(event.target.value)}
          >
            {snapshots.map(snapshot => (
              <option key={snapshot.href} value={snapshot.href}>
                {snapshot.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <SourceText key={href} href={href} />
    </>
  );
}

type SourceLoadState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'failed' };

// Callers key this component by href so a new snapshot starts with fresh state.
function SourceText({ href }: { href: string | null }) {
  const [source, setSource] = useState<SourceLoadState>({ status: 'loading' });

  useEffect(() => {
    if (!href) return;
    const controller = new AbortController();

    async function loadSource(sourceHref: string) {
      try {
        const response = await fetch(sourceHref, { signal: controller.signal });
        if (!response.ok) throw new Error('Source unavailable');
        const text = await response.text();
        if (!controller.signal.aborted) setSource({ status: 'ready', text });
      } catch {
        if (!controller.signal.aborted) setSource({ status: 'failed' });
      }
    }

    void loadSource(href);
    return () => controller.abort();
  }, [href]);

  if (!href) return <p>No source snapshot was captured.</p>;
  if (source.status === 'loading') return <p>Loading source…</p>;
  if (source.status === 'failed') return <p>Source snapshot unavailable.</p>;
  return <pre className="card__code">{source.text}</pre>;
}
