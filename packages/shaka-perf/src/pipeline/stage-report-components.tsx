/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { renderPipelineDialogMetaUrls } from './pipeline-artifacts';
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

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  variant?: 'default' | 'compact' | 'wide';
}

export function Dialog({
  open,
  onClose,
  title,
  meta,
  children,
  variant = 'default',
}: DialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

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
      className={`ui-dialog${variant === 'default' ? '' : ` ui-dialog--${variant}`}`}
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
        <div className="ui-dialog__body">{children}</div>
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

export function StageArtifactProvider({
  children,
  test,
}: {
  children: ReactNode;
  test: StageArtifactTestMeta;
}) {
  return (
    <StageArtifactContext.Provider value={test}>
      {children}
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
  { children, verbatim = false }: { children: ReactNode; verbatim?: boolean },
) {
  // `verbatim` opts out of the default uppercase transform so human-readable
  // multi-word titles (e.g. compare section headings) keep their own casing.
  const className = verbatim
    ? 'stage-artifact__title stage-artifact__title--verbatim'
    : 'stage-artifact__title';
  return <div className={className}>{children}</div>;
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
  href,
  label,
  variant,
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
  href: string;
  label: string;
  variant?: 'preview';
}) {
  const [open, setOpen] = useState(false);
  const test = useContext(StageArtifactContext);
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
          open={open}
          onClose={() => setOpen(false)}
          title={<span className="ui-dialog__title-text">{label}</span>}
          meta={test ? <TestMeta test={test} extra={extra} /> : null}
        >
          {body ?? <iframe className="artifact-dialog__frame" src={href} title={label} />}
        </Dialog>
      ) : null}
    </>
  );
}

/**
 * Forces an inline SVG to fill its container — pair with PreviewButton when
 * the preview content is a `dangerouslySetInnerHTML` SVG that would otherwise
 * render at its natural width.
 */
export function svgWithFullWidthStyle(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/, (_match, attrs: string) => {
    const styleMatch = attrs.match(/\sstyle=(["'])(.*?)\1/);
    if (!styleMatch) return `<svg style="${FULL_WIDTH_SVG_STYLE}"${attrs}>`;
    const [styleAttr, quote, currentStyle] = styleMatch;
    const nextStyle = `${currentStyle};${FULL_WIDTH_SVG_STYLE}`;
    return `<svg${attrs.replace(styleAttr, ` style=${quote}${nextStyle}${quote}`)}>`;
  });
}

const FULL_WIDTH_SVG_STYLE = 'display:block;height:auto;width:100%';

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
