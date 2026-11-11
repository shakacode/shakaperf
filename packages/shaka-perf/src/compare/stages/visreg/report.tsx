/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { StageRenderEntry } from '../../../stage/stage';
import type { VisregArtifact, VisregResult } from '../visreg';
import { DetailedArtifactDialog, StageArtifact, StageArtifactTitle, ReportHeading, OldRunChip, StageNote, RecoveryBadges } from '../../../pipeline/stage-report-components';
import { ImageViewport } from '../../../pipeline/image-viewport';
import { Scrubber } from './scrubber';

export function VisregArtifactView({
  measurements,
}: {
  measurements: readonly StageRenderEntry<VisregResult>[];
}) {
  const rows = measurements
    .flatMap((entry) => entry.measurement.map((artifact) => ({
      artifact,
      entry,
      viewportLabel: entry.executionDetails.viewport.label,
      latestRun: entry.latestRun,
    })))
    .sort((a, b) => a.artifact.selector.localeCompare(b.artifact.selector) || a.viewportLabel.localeCompare(b.viewportLabel));

  if (rows.length === 0) {
    return (
      <StageArtifact>
        <StageArtifactTitle verbatim title="Visual Diff" />
        <StageNote body="no artifacts" />
      </StageArtifact>
    );
  }
  return (
    <StageArtifact>
      <StageArtifactTitle verbatim title="Visual Diff" />
      <div className="artifact-stack">
        <div className="artifact-grid">
          {rows.map((row, index) => (
            <VisregCard key={`${row.artifact.selector}-${row.viewportLabel}-${index}`} row={row} />
          ))}
        </div>
      </div>
    </StageArtifact>
  );
}

interface VisregRow {
  entry: StageRenderEntry<VisregResult>;
  latestRun: boolean;
  artifact: VisregArtifact;
  viewportLabel: string;
}

function VisregCard({ row }: { row: VisregRow }) {
  const { artifact, viewportLabel } = row;
  const changed = artifact.diffImage !== null;
  const head = (
    <div className="artifact-card__head">
      <ReportHeading className="artifact-card__title" level={5} title={viewportLabel} badge={<OldRunChip latestRun={row.latestRun} />} />
      <span className="artifact-card__subtitle">{artifact.selector}</span>
      <span className="artifact-card__value">{artifact.misMatchPercentage.toFixed(2)}%</span>
      {changed ? <span className="artifact-card__status">visual change</span> : null}
    </div>
  );

  return artifact.diffImage !== null ? (
    <div className="artifact-card artifact-card--compare">
      {head}
      <DetailedArtifactDialog
        image
        className="artifact-card__media-button"
        href={artifact.diffImage}
        label={`${viewportLabel} ${artifact.selector}`}
        fields={visualComparisonFields(row)}
        executionDetails={row.entry.executionDetails}
        body={<VisregDialogImages row={artifact} diffImage={artifact.diffImage} />}
      >
        <DiffImages row={artifact} diffImage={artifact.diffImage} />
      </DetailedArtifactDialog>
    </div>
  ) : (
    <div className="artifact-card artifact-card--single">
      {head}
      <DetailedArtifactDialog
        image
        className="artifact-card__media-button"
        href={artifact.controlImage}
        label={`${viewportLabel} ${artifact.selector}`}
        fields={visualComparisonFields(row)}
        executionDetails={row.entry.executionDetails}
        body={<VisregDialogImages row={artifact} />}
      >
        <div className="artifact-card__media">
          <ImageCell kind="no diff" src={artifact.controlImage}>
            <RecoveryBadges taskRecovered={row.entry.executionDetails.recoveredAfterRetries} comparisonRecovered={artifact.savedByRetries} />
          </ImageCell>
        </div>
      </DetailedArtifactDialog>
    </div>
  );
}

export function visualComparisonFields({ artifact, viewportLabel, entry }: Pick<VisregRow, 'artifact' | 'viewportLabel' | 'entry'>): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {
    viewport: `${viewportLabel} ${entry.executionDetails.viewport.width} × ${entry.executionDetails.viewport.height}`,
    selector: artifact.selector,
    mismatch: `${artifact.misMatchPercentage.toFixed(2)}%`,
  };
  if (artifact.compareAttempts === undefined) {
    if (artifact.savedByRetries) fields['visual comparisons'] = 'Matched after retrying · comparison count unavailable';
  } else if (artifact.compareAttempts > 1) {
    const limit = artifact.compareRetries === undefined ? '?' : artifact.compareRetries + 1;
    fields['visual comparisons'] = `${artifact.compareAttempts}/${limit}${artifact.savedByRetries ? ' · matched on retry' : ''}`;
  }
  return fields;
}

function DiffImages({ row, diffImage }: { row: VisregArtifact; diffImage: string }) {
  const b = row.diffBbox;
  const cropStyle = b ? ({
    '--crop-x': b.x,
    '--crop-y': b.y,
    '--crop-w': b.w,
    '--crop-h': b.h,
    '--img-w': b.imgW,
  } as CSSProperties) : undefined;
  const className = b
    ? 'artifact-card__media artifact-card__media--triplet artifact-card__media--crop'
    : 'artifact-card__media artifact-card__media--triplet';
  return (
    <div className={className} style={cropStyle}>
      <ImageCell kind="control" src={row.controlImage} imgH={b?.controlImgH} />
      <ImageCell kind="experiment" src={row.experimentImage} imgH={b?.experimentImgH} />
      <ImageCell kind="diff" src={diffImage} imgH={b?.diffImgH} />
    </div>
  );
}

function VisregDialogImages({ row, diffImage }: { row: VisregArtifact; diffImage?: string }) {
  // control · experiment · diff · scrubber — the scrubber column sits to the
  // right of the diff and overlays control/experiment behind a draggable wipe.
  return (
    <div className={`artifact-dialog__image-grid${diffImage ? ' artifact-dialog__image-grid--quad' : ''}`}>
      <DialogImage kind={diffImage ? 'control' : 'no diff'} src={row.controlImage} />
      {diffImage ? (
        <>
          <DialogImage kind="experiment" src={row.experimentImage} />
          <DialogImage kind="diff" src={diffImage} />
          <DialogScrubber row={row} />
        </>
      ) : null}
    </div>
  );
}

function DialogScrubber({ row }: { row: VisregArtifact }) {
  const b = row.diffBbox;
  const maxImgH = b ? Math.max(b.controlImgH, b.experimentImgH) : undefined;
  return (
    <figure className="artifact-dialog__image artifact-dialog__image--scrubber">
      <figcaption>scrubber · control ↔ experiment</figcaption>
      <ImageViewport actualSize="fit-width" width={b?.imgW} height={maxImgH}>
        <Scrubber
          beforeSrc={row.controlImage}
          afterSrc={row.experimentImage}
          imgW={b?.imgW}
          maxImgH={maxImgH}
        />
      </ImageViewport>
    </figure>
  );
}

function DialogImage({ kind, src }: { kind: string; src: string }) {
  return (
    <figure className="artifact-dialog__image">
      <figcaption>{kind}</figcaption>
      <ImageViewport actualSize="fit-width"><img src={src} alt={kind} /></ImageViewport>
    </figure>
  );
}

function ImageCell({ kind, src, imgH, children }: {
  kind: string;
  src: string;
  imgH?: number;
  children?: ReactNode;
}) {
  const style = imgH == null ? undefined : ({ '--img-h': imgH } as CSSProperties);
  return (
    <div className="artifact-card__image">
      <img src={src} alt={kind} loading="lazy" style={style} />
      <span className="artifact-card__image-labels">
        <span className="artifact-card__image-label">{kind}</span>
        {children}
      </span>
    </div>
  );
}
