/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react';
import { useReportSection } from './report-section';
import { ReportHeading, type ReportHeadingProps } from './report-heading';
import { ImageViewport } from './image-viewport';
import { ArtifactDialogMetadata } from '../report-ui/ArtifactDialogMetadata';
import { Dialog } from '../report-ui/Dialog';
import { useTestCard } from '../report-ui/TestCardProvider';
export { Dialog };
export { ArtifactMetadataFields } from '../report-ui/ArtifactMetadataFields';

export { ReportHeading } from './report-heading';

export function RecoveryBadges({
  taskRecovered,
  comparisonRecovered,
}: {
  taskRecovered: boolean;
  comparisonRecovered: boolean;
}) {
  return (
    <>
      {taskRecovered ? (
        <span
          className="artifact-card__image-label artifact-card__image-label--flaky"
          title="A task failed, then succeeded on retry."
        >
          flaky
        </span>
      ) : null}
      {comparisonRecovered ? (
        <span
          className="artifact-card__image-label artifact-card__image-label--unstable"
          title="Screenshots differed initially, then matched on retry."
        >
          unstable
        </span>
      ) : null}
    </>
  );
}

// Whole-test warnings and bisect reports suppress repeated viewport warnings,
// without changing the freshness metadata supplied to stage renderers.
const StageRunChipsContext = createContext(true);
export const StageRunChipsProvider = StageRunChipsContext.Provider;

export function OldRunChip({ latestRun }: { latestRun: boolean }) {
  const visible = useContext(StageRunChipsContext);
  return visible && latestRun === false
    ? <span className="pill pill--gray old-run-chip">old run</span>
    : null;
}

export function StageArtifact({ children }: { children: ReactNode }) {
  return (
    <div className="stage-artifact__content">
      {children}
    </div>
  );
}

export function StageArtifactTitle(
  { title, badge, verbatim = false }: Pick<ReportHeadingProps, 'title' | 'badge'> & { verbatim?: boolean },
) {
  const section = useReportSection();
  // The enclosing report section owns the main heading. Subsections use
  // ReportHeading directly, independently of the title's JSX structure.
  if (section != null) return null;
  // `verbatim` opts out of the default uppercase transform so human-readable
  // multi-word titles (e.g. compare section headings) keep their own casing.
  const className = verbatim
    ? 'stage-artifact__title stage-artifact__title--verbatim'
    : 'stage-artifact__title';
  return <ReportHeading className={className} title={title} badge={badge} />;
}

export function StageNote({ body, label }: { body: string; label?: string }) {
  return (
    <div className="stage-note">
      {label ? <span className="stage-note__label">{label}</span> : null}
      <span className="stage-note__body">{body}</span>
    </div>
  );
}

function ArtifactDialogTitle({ children }: { children: ReactNode }) {
  const { test } = useTestCard();
  return (
    <span className="ui-dialog__title-text">
      {children} · {test.name}
    </span>
  );
}

type DialogProps = ComponentProps<typeof Dialog>;

type DetailedArtifactDialogProps = Pick<DialogProps, 'title' | 'image'> &
  ComponentProps<typeof ArtifactDialogMetadata> & {
    href: string;
    label: string;
    children?: ReactNode;
    body?: ReactNode;
    className?: string;
    variant?: 'preview';
    dialogVariant?: DialogProps['variant'];
  };

export function DetailedArtifactDialog({
  href,
  label,
  title = label,
  children,
  body,
  className,
  variant,
  dialogVariant,
  image,
  ...metadataProps
}: DetailedArtifactDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === 'preview' ? (
        <PreviewButton onClick={() => setOpen(true)}>
          {children ?? label}
        </PreviewButton>
      ) : (
        <button type="button" className={className} onClick={() => setOpen(true)}>
          {children ?? label}
        </button>
      )}
      {open ? (
        <Dialog
          open
          image={image}
          variant={dialogVariant}
          onClose={() => setOpen(false)}
          title={<ArtifactDialogTitle>{title}</ArtifactDialogTitle>}
          meta={<ArtifactDialogMetadata {...metadataProps} />}
        >
          {body ??
            (image ? (
              <ImageViewport>
                <img src={href} alt={label} />
              </ImageViewport>
            ) : (
              <iframe className="artifact-dialog__frame" src={href} title={label} />
            ))}
        </Dialog>
      ) : null}
    </>
  );
}

function PreviewButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'block',
        width: '100%',
        marginTop: 12,
        padding: 0,
        border: `1px solid ${hovered ? 'var(--fg-muted)' : 'var(--border-strong)'}`,
        background: 'var(--bg-elevated)',
        // `color: inherit` here defeats the global `button:hover { color: #fff }`
        // (which would otherwise turn the inline "Lighthouse report" / profile-frames
        // label invisible on hover).
        color: 'inherit',
        cursor: 'zoom-in',
        appearance: 'none',
        // The global `button { text-transform: lowercase }` mangles labels
        // we render *inside* the button (e.g. "Lighthouse report" → "lighthouse
        // report"); reset to none here so proper-noun casing survives.
        textTransform: 'none',
        letterSpacing: 'normal',
      }}
    >
      {children}
    </button>
  );
}
