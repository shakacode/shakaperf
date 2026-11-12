/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useEffect, useState } from 'react';
import type { ExecutionDetails } from '../../../src/pipeline/outcome';
import type { ReportOutcome } from '../types';

export function ExecutionDetailsSource({ outcomes, executionDetails }: {
  outcomes: readonly ReportOutcome[];
  executionDetails?: ExecutionDetails;
}) {
  const sources = outcomes
    .filter(outcome => outcome.executionDetails.testSourceHref !== null)
    .sort((a, b) => b.executionDetails.runId.localeCompare(a.executionDetails.runId))
    .filter((outcome, index, sorted) => sorted.findIndex(candidate =>
      candidate.executionDetails.testSourceHref === outcome.executionDetails.testSourceHref) === index);
  const [selection, setSelection] = useState<string | null>(null);
  const selected = sources.find(outcome => outcome.executionDetails.testSourceHref === selection) ?? sources[0];
  const href = executionDetails ? executionDetails.testSourceHref : selected?.executionDetails.testSourceHref;
  return <>
    {!executionDetails && sources.length > 1 ? <label>Source snapshot{' '}
      <select aria-label="Source snapshot" value={selected?.executionDetails.testSourceHref ?? ''} onChange={event => setSelection(event.target.value)}>
        {sources.map(outcome => <option key={outcome.executionDetails.testSourceHref} value={outcome.executionDetails.testSourceHref!}>
          {outcome.stage} · {outcome.executionDetails.viewport.label} · {outcome.executionDetails.runId}
        </option>)}
      </select>
    </label> : null}
    {href ? <SourceText key={href} href={href} /> : <p>No source snapshot was captured.</p>}
  </>;
}

function SourceText({ href }: { href: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(href, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Source unavailable');
        return response.text();
      })
      .then(setText)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [href]);
  if (failed) return <p>Source snapshot unavailable.</p>;
  if (text === null) return <p>Loading source…</p>;
  return <pre className="card__code">{text}</pre>;
}
