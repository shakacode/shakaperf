/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CSSProperties } from 'react';
import type { StageRenderEntry } from '../../../stage/stage';
import type { VisregArtifact, VisregResult } from '../visreg';
import { DetailedArtifactDialog, StageArtifact, StageArtifactTitle, StageNote } from '../../../pipeline/stage-report-components';
import { Scrubber } from './scrubber';

export function VisregArtifactView({
  measurements,
}: {
  measurements: readonly StageRenderEntry<VisregResult>[];
}) {
  const rows = measurements
    .flatMap((entry) => entry.measurement.map((artifact) => ({
      artifact,
      viewportLabel: entry.viewport.label,
    })))
    .sort((a, b) => a.artifact.selector.localeCompare(b.artifact.selector) || a.viewportLabel.localeCompare(b.viewportLabel));

  if (rows.length === 0) {
    return (
      <StageArtifact>
        <StageArtifactTitle verbatim>Visual Diff</StageArtifactTitle>
        <StageNote body="no artifacts" />
      </StageArtifact>
    );
  }
  return (
    <StageArtifact>
      <StageArtifactTitle verbatim>Visual Diff</StageArtifactTitle>
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
  artifact: VisregArtifact;
  viewportLabel: string;
}

function VisregCard({ row }: { row: VisregRow }) {
  const { artifact, viewportLabel } = row;
  const changed = artifact.diffImage !== null;
  const head = (
    <div className="artifact-card__head">
      <span className="artifact-card__title">{viewportLabel}</span>
      <span className="artifact-card__subtitle">{artifact.selector}</span>
      <span className="artifact-card__value">{artifact.misMatchPercentage.toFixed(2)}%</span>
      {changed ? <span className="artifact-card__status">visual change</span> : null}
    </div>
  );

  return artifact.diffImage !== null ? (
    <div className="artifact-card artifact-card--compare">
      {head}
      <DetailedArtifactDialog
        className="artifact-card__media-button"
        href={artifact.diffImage}
        label={`${viewportLabel} ${artifact.selector}`}
        extra={<VisregMeta row={row} />}
        body={<VisregDialogImages row={artifact} diffImage={artifact.diffImage} />}
      >
        <DiffImages row={artifact} diffImage={artifact.diffImage} />
      </DetailedArtifactDialog>
    </div>
  ) : (
    <div className="artifact-card artifact-card--single">
      {head}
      <DetailedArtifactDialog
        className="artifact-card__media-button"
        href={artifact.controlImage}
        label={`${viewportLabel} ${artifact.selector}`}
        extra={<VisregMeta row={row} />}
        body={<VisregDialogImages row={artifact} />}
      >
        <div className="artifact-card__media">
          <ImageCell kind="no diff" src={artifact.controlImage} />
        </div>
      </DetailedArtifactDialog>
    </div>
  );
}

function VisregMeta({ row }: { row: VisregRow }) {
  const { artifact, viewportLabel } = row;
  return (
    <>
      <div>
        <dt>viewport</dt>
        <dd>{viewportLabel}</dd>
      </div>
      <div>
        <dt>selector</dt>
        <dd>{artifact.selector}</dd>
      </div>
      <div>
        <dt>mismatch</dt>
        <dd>{artifact.misMatchPercentage.toFixed(2)}%</dd>
      </div>
    </>
  );
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
      <Scrubber
        beforeSrc={row.controlImage}
        afterSrc={row.experimentImage}
        imgW={b?.imgW}
        maxImgH={maxImgH}
      />
    </figure>
  );
}

function DialogImage({ kind, src }: { kind: string; src: string }) {
  return (
    <figure className="artifact-dialog__image">
      <figcaption>{kind}</figcaption>
      <img src={src} alt={kind} />
    </figure>
  );
}

function ImageCell({ kind, src, imgH }: { kind: string; src: string; imgH?: number }) {
  const style = imgH == null ? undefined : ({ '--img-h': imgH } as CSSProperties);
  return (
    <div className="artifact-card__image">
      <img src={src} alt={kind} loading="lazy" style={style} />
      <span className="artifact-card__image-label">{kind}</span>
    </div>
  );
}
