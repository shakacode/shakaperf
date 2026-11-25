/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { useId, useState, type ReactNode } from 'react';
import type { ExecutionDetails } from '../pipeline/outcome';
import { TargetLink } from './TargetLink';
import { SourceText } from './SourceText';
import { CopyableText } from './CopyableText';
import { useTestCard } from './TestCardProvider';

// Full-word units so "12m" isn't mistaken for "12 months" — especially
// relevant in merged --report-only views where artifacts can be weeks old.
function pluralize(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function formatMeasuredAt(measuredAt: number | null): string | null {
  if (measuredAt == null) return 'never measured';
  const diffMs = Date.now() - measuredAt;
  if (diffMs < 0) return 'just now';
  const totalHours = Math.floor(diffMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (diffMs < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.floor(diffMs / (60 * 1000)));
    return `${pluralize(mins, 'minute')} ago`;
  }
  if (days === 0) return `${pluralize(hours, 'hour')} ago`;
  if (hours === 0) return `${pluralize(days, 'day')} ago`;
  return `${pluralize(days, 'day')} ${pluralize(hours, 'hour')} ago`;
}

export interface TestMetadataDisplayOptions {
  expanded?: boolean;
  onToggleExpanded?: () => void;
  defaultExpanded?: boolean;
  variant?: 'card' | 'dialog';
}

interface TestMetadataSectionProps extends TestMetadataDisplayOptions {
  executionDetails?: ExecutionDetails;
  measuredAt: number | null;
  troubleshoot: readonly string[];
  children?: ReactNode;
}

export function TestMetadataSection({
  executionDetails, measuredAt, troubleshoot, children,
  expanded: sharedExpanded, onToggleExpanded, defaultExpanded = false, variant = 'card',
}: TestMetadataSectionProps) {
  const { test, targets } = useTestCard();
  const commitsBySide = new Map(
    executionDetails?.measurementMetadata?.targets.map(({ side, commit }) => [side, commit]),
  );
  const [localExpanded, setLocalExpanded] = useState(defaultExpanded);
  const expanded = sharedExpanded ?? localExpanded;
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const panelId = useId();
  const testSourceHref = executionDetails?.testSourceHref ?? null;
  const sections = [
    {
      id: 'command',
      label: 'command',
      content: executionDetails?.measurementMetadata ? (
        <>
          <div className="run-details__label">Latest command</div>
          <CopyableText
            key={executionDetails.command}
            text={executionDetails.command}
            label="Latest command"
            copyLabel="Copy command"
            singleRow
          />
        </>
      ) : null,
    },
    {
      id: 'source',
      label: 'test source',
      content: <SourceText key={testSourceHref} href={testSourceHref} />,
    },
    {
      id: 'troubleshoot',
      label: 'troubleshoot',
      content: troubleshoot.length ? troubleshoot.map((command, index) => (
        <CopyableText key={command} text={command} label="Troubleshoot command"
          copyLabel={`Copy troubleshoot command ${index + 1}`} />
      )) : null,
    },
    {
      id: 'artifacts',
      label: 'artifact paths',
      content: test.viewportArtifactPaths?.length ? test.viewportArtifactPaths.map(({ viewport, path }) => (
        <CopyableText key={viewport} text={path} prefix={`${viewport}: `} label={`${viewport} artifact path`}
          copyLabel={`Copy ${viewport} artifact path`} />
      )) : null,
    },
  ].filter((section) => section.content !== null);
  const active = sections.find((section) => section.id === activeSection);
  const fileAndTime = (
    <span className="card__metadata-file-time">
      <span className="card__path" title={test.filePath}>
        {test.filePath}
      </span>
      <span className="card__measured-at">
        <span className="card__metadata-separator" aria-hidden="true">
          ·{' '}
        </span>
        updated {formatMeasuredAt(measuredAt)}
      </span>
    </span>
  );
  return (
    <details className={`card__disclosure card__metadata card__metadata--${variant}`} open={expanded}>
      <summary onClick={(event) => {
        event.preventDefault();
        if (onToggleExpanded) onToggleExpanded();
        else setLocalExpanded((previous) => !previous);
      }}>
        <span>Metadata</span>
        {variant === 'dialog' ? fileAndTime : null}
      </summary>
      <div className="card__metadata-content">
        {variant === 'card' ? fileAndTime : null}
        <dl className="card__urls card__targets" aria-label="URLs">
          {targets.map(target => (
            <TargetLink key={target.side} target={target} commit={commitsBySide.get(target.side)} />
          ))}
        </dl>
        {children}
        {sections.length ? (
          <div>
            <div className="card__metadata-controls" aria-label="Metadata sections">
              {sections.map(({ id, label }) => (
                <button
                  key={id}
                  id={`${panelId}-${id}`}
                  type="button"
                  className="card__code-toggle"
                  aria-label={label}
                  aria-expanded={active?.id === id}
                  aria-controls={panelId}
                  onClick={() => setActiveSection((previous) => (previous === id ? null : id))}
                >
                  {active?.id === id ? '▾' : '▸'} {label}
                </button>
              ))}
            </div>
            <div
              id={panelId}
              className="card__metadata-panel"
              hidden={!active}
              aria-labelledby={active ? `${panelId}-${active.id}` : undefined}
            >
              {active?.content}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}
