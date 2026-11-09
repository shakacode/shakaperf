/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useReportSection } from './report-section';
import { ReportHeading, type ReportHeadingProps } from './report-heading';
import { ImageSizeContext, ImageViewport } from './image-viewport';
import { renderPipelineDialogMetaUrls } from './pipeline-artifacts';
import type { Outcome } from './outcome';

export { ReportHeading } from './report-heading';

export interface StageArtifactTestMeta {
  readonly name: string;
  readonly filePath: string;
  readonly startingPath: string;
  readonly controlUrl: string;
  readonly experimentUrl: string;
  readonly pipelineName?: string;
  readonly pipelineConfig?: unknown;
}

const StageArtifactContext = createContext<StageArtifactTestMeta | null>(null);
type ArtifactMetadataRenderer = (extra: ReactNode, outcome?: Outcome, settings?: ReactNode) => ReactNode;
const ArtifactMetadataContext = createContext<ArtifactMetadataRenderer | null>(null);
const ArtifactOutcomeContext = createContext<{ outcome?: Outcome; settings?: ReactNode }>({});

/** Bind metadata to the result that produced this artifact, including legacy results. */
export function ArtifactScope({ outcome, settings, children }: { outcome?: Outcome; settings?: ReactNode; children: ReactNode }) {
  return <ArtifactOutcomeContext.Provider value={{ outcome, settings }}>{children}</ArtifactOutcomeContext.Provider>;
}

export function ArtifactDialogTitle({ title }: { title: ReactNode }) {
  const test = useContext(StageArtifactContext);
  return <span className="ui-dialog__title-text">{title}{test ? <> · {test.name}</> : null}</span>;
}

/** Wrap stage-specific fields in the shell's shared metadata disclosure. */
export function ArtifactMetadata({ children }: { children?: ReactNode }) {
  const renderMetadata = useContext(ArtifactMetadataContext);
  const { outcome, settings } = useContext(ArtifactOutcomeContext);
  const test = useContext(StageArtifactContext);
  if (renderMetadata) return renderMetadata(children, outcome, settings);
  return (
    <details className="card__disclosure card__metadata" open>
      <summary>Metadata</summary>
      <div className="card__metadata-content">{test ? <TestMeta test={test} /> : null}{settings}{children}</div>
    </details>
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

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  variant?: 'default' | 'compact' | 'wide';
  image?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  meta,
  children,
  variant = 'default',
  image = false,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const [imageSize, setImageSize] = useState<'fit' | 'actual'>('fit');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    const onClick = (event: MouseEvent) => {
      if (event.target === el) onClose();
    };
    el.addEventListener('cancel', onCancel);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('cancel', onCancel);
      el.removeEventListener('click', onClick);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`ui-dialog${image ? ' ui-dialog--image' : ''}${variant === 'default' ? '' : ` ui-dialog--${variant}`}`}
      aria-labelledby={title ? titleId : undefined}
    >
      <div className="ui-dialog__surface">
        <header className="ui-dialog__head">
          <div id={title ? titleId : undefined} className="ui-dialog__title">{title}</div>
          <button
            type="button"
            className="ui-dialog__close"
            aria-label="close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {meta ? <div className="ui-dialog__meta-wrap">{meta}</div> : null}
        {image ? (
          <div className="image-size" role="group" aria-label="Image size">
            <button type="button" aria-pressed={imageSize === 'fit'} onClick={() => setImageSize('fit')}>Fit to window</button>
            <button type="button" aria-pressed={imageSize === 'actual'} onClick={() => setImageSize('actual')}>Actual size</button>
          </div>
        ) : null}
        <div className="ui-dialog__body">
          <ImageSizeContext.Provider value={imageSize}>{children}</ImageSizeContext.Provider>
        </div>
      </div>
    </dialog>
  );
}

export function TestMeta({
  test,
  extra,
}: {
  test: StageArtifactTestMeta;
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
      <TestMetaUrls test={test} />
    </dl>
  );
}

function TestMetaUrls({ test }: { test: StageArtifactTestMeta }) {
  return <>{renderPipelineDialogMetaUrls(test)}</>;
}

export function useStageArtifactTest(): StageArtifactTestMeta | null {
  return useContext(StageArtifactContext);
}

export function StageArtifactProvider({
  children,
  test,
  renderMetadata,
}: {
  children: ReactNode;
  test: StageArtifactTestMeta;
  renderMetadata: ArtifactMetadataRenderer;
}) {
  return (
    <StageArtifactContext.Provider value={test}>
      <ArtifactMetadataContext.Provider value={renderMetadata}>{children}</ArtifactMetadataContext.Provider>
    </StageArtifactContext.Provider>
  );
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

export function DetailedArtifactDialog({
  body,
  children,
  className,
  extra,
  meta,
  href,
  label,
  title = label,
  variant,
  image = false,
}: {
  body?: ReactNode;
  children?: ReactNode;
  /**
   * Escape hatch for one-off layout classes (visreg's image-grid button, …).
   * For the recurring "preview tile" styling, use `variant="preview"` instead
   * so the styles travel with the component rather than living in a global
   * CSS file keyed by class name.
   */
  className?: string;
  extra?: ReactNode;
  meta?: ReactNode;
  href: string;
  label: string;
  title?: ReactNode;
  variant?: 'preview';
  image?: boolean;
}) {
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
          image={image}
          open={open}
          onClose={() => setOpen(false)}
          title={<ArtifactDialogTitle title={title} />}
          meta={meta ?? <ArtifactMetadata>{extra ? <dl className="ui-dialog__meta">{extra}</dl> : null}</ArtifactMetadata>}
        >
          {body ?? (image ? <ImageViewport><img src={href} alt={label} /></ImageViewport> : <iframe className="artifact-dialog__frame" src={href} title={label} />)}
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
