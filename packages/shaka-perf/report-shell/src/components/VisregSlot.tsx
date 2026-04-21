import { useState, type CSSProperties } from 'react';
import type { TestResult, VisregArtifact } from '../types';
import { Dialog } from './Dialog';
import { Scrubber } from './Scrubber';
import { TestMeta } from './TestMeta';

const EMPTY: VisregArtifact[] = [];

interface RowProps {
  row: VisregArtifact;
  onOpen: (row: VisregArtifact) => void;
}

function CardHead({ row, showDiffChip }: { row: VisregArtifact; showDiffChip?: boolean }) {
  return (
    <div className="visreg-card__head">
      <span className="visreg-card__viewport">{row.viewportLabel}</span>
      <span className="visreg-card__selector">{row.selector}</span>
      <span className="visreg-card__pct">{row.misMatchPercentage.toFixed(2)}%</span>
      {showDiffChip ? <span className="visreg-card__diff-chip">visual change</span> : null}
    </div>
  );
}

/**
 * Consumed by CSS inside `.visreg-card__images--crop` to scale+offset each
 * image inside its container so the first-diff bbox fills the card. The
 * crop geometry (x/y/w/h, imgW) is shared across the triplet, but each
 * <img> gets its own --img-h — pixelmatch pads to `max(control, experiment)`
 * so the three images often differ in natural height, and the Y offset has
 * to reference each image's real height to land on the same source pixels.
 */
function tripletVarsFor(row: VisregArtifact): CSSProperties | undefined {
  const b = row.diffBbox;
  if (!b) return undefined;
  return {
    ['--crop-x' as string]: b.x,
    ['--crop-y' as string]: b.y,
    ['--crop-w' as string]: b.w,
    ['--crop-h' as string]: b.h,
    ['--img-w' as string]: b.imgW,
  };
}

function imgVarsFor(imgH: number): CSSProperties {
  return { ['--img-h' as string]: imgH };
}

function DiffCard({ row, onOpen }: RowProps) {
  const tripletStyle = tripletVarsFor(row);
  const cls = tripletStyle
    ? 'visreg-card__images visreg-card__images--triplet visreg-card__images--crop'
    : 'visreg-card__images visreg-card__images--triplet';
  const bbox = row.diffBbox;
  return (
    <div className="visreg-card visreg-card--diff">
      <CardHead row={row} showDiffChip />
      <button
        type="button"
        className={`${cls} visreg-card__images--clickable`}
        style={tripletStyle}
        onClick={() => onOpen(row)}
        aria-label={`open ${row.selector} at ${row.viewportLabel}`}
      >
        <div className="visreg-card__img" data-kind="control">
          <img
            src={row.controlImage}
            alt="control"
            loading="lazy"
            style={bbox ? imgVarsFor(bbox.controlImgH) : undefined}
          />
        </div>
        <div className="visreg-card__img" data-kind="experiment">
          <img
            src={row.experimentImage}
            alt="experiment"
            loading="lazy"
            style={bbox ? imgVarsFor(bbox.experimentImgH) : undefined}
          />
        </div>
        <div className="visreg-card__img" data-kind="diff">
          <img
            src={row.diffImage!}
            alt="diff"
            loading="lazy"
            style={bbox ? imgVarsFor(bbox.diffImgH) : undefined}
          />
        </div>
      </button>
    </div>
  );
}

function NoDiffCard({ row, onOpen }: RowProps) {
  return (
    <div className="visreg-card visreg-card--nodiff">
      <CardHead row={row} />
      <button
        type="button"
        className="visreg-card__images visreg-card__images--clickable"
        onClick={() => onOpen(row)}
        aria-label={`open ${row.selector} at ${row.viewportLabel}`}
      >
        <div className="visreg-card__img" data-kind="no-diff">
          <img src={row.controlImage} alt="screenshot" loading="lazy" />
        </div>
      </button>
    </div>
  );
}

// Default render scale for full-size screenshots in the dialog. 0.5 keeps
// long mobile screenshots manageable out of the box; users can browser-zoom
// if they need to inspect finer detail.
const DEFAULT_ZOOM = 0.5;

function scaledWidthPx(w: number | undefined): string | undefined {
  return w != null ? `${Math.round(w * DEFAULT_ZOOM)}px` : undefined;
}

function DiffView({ row }: { row: VisregArtifact }) {
  const [scrubPos, setScrubPos] = useState(50);
  const b = row.diffBbox;
  const maxImgH = b ? Math.max(b.controlImgH, b.experimentImgH) : undefined;
  const scaledW = scaledWidthPx(b?.imgW);
  // Share --scrub-pos with the sticky chip row so its clip-path regions wipe
  // in lockstep with the scrubber divider; --scrub-w matches the scrubber's
  // rendered width so the chip row has the same geometry.
  const scrubCol: CSSProperties = {
    ['--scrub-pos' as string]: `${scrubPos}%`,
    ...(scaledW ? ({ ['--scrub-w' as string]: scaledW } as CSSProperties) : null),
  };
  const diffStyle: CSSProperties | undefined =
    scaledW ? { width: scaledW } : undefined;
  return (
    <div className="visreg-dialog">
      <div className="visreg-dialog__col" style={scrubCol}>
        <div className="visreg-dialog__col-head">scrubber</div>
        <div className="scrubber-chips">
          <div className="scrubber-chips__side scrubber-chips__side--left">
            <span className="scrubber-chip">control</span>
          </div>
          <div className="scrubber-chips__side scrubber-chips__side--right">
            <span className="scrubber-chip">experiment</span>
          </div>
        </div>
        <Scrubber
          beforeSrc={row.controlImage}
          afterSrc={row.experimentImage}
          imgW={b ? Math.round(b.imgW * DEFAULT_ZOOM) : undefined}
          maxImgH={maxImgH ? Math.round(maxImgH * DEFAULT_ZOOM) : undefined}
          pos={scrubPos}
          onPosChange={setScrubPos}
        />
      </div>
      <div className="visreg-dialog__col">
        <div className="visreg-dialog__col-head">diff</div>
        {/* Spacer that matches the scrubber column's chip row so the two
            image canvases start at the same Y under the sticky headers. */}
        <div className="scrubber-chips scrubber-chips--spacer" aria-hidden="true" />
        {row.diffImage ? (
          <img
            className="visreg-dialog__img"
            src={row.diffImage}
            alt="diff"
            style={diffStyle}
          />
        ) : null}
      </div>
    </div>
  );
}

function DialogBody({ row }: { row: VisregArtifact }) {
  if (row.diffImage) {
    return <DiffView row={row} />;
  }
  const scaledW = scaledWidthPx(row.diffBbox?.imgW);
  const imgStyle: CSSProperties | undefined =
    scaledW ? { width: scaledW } : undefined;
  return (
    <div className="visreg-dialog visreg-dialog--single">
      <div className="visreg-dialog__col">
        <div className="visreg-dialog__col-head">screenshot · no diff</div>
        <img
          className="visreg-dialog__img"
          src={row.controlImage}
          alt="screenshot"
          style={imgStyle}
        />
      </div>
    </div>
  );
}

function VisregDialogMeta({ test, row }: { test: TestResult; row: VisregArtifact }) {
  return (
    <TestMeta
      test={test}
      extra={
        <>
          <div>
            <dt>viewport</dt>
            <dd>{row.viewportLabel}</dd>
          </div>
          <div>
            <dt>selector</dt>
            <dd className="ui-dialog__meta-break">{row.selector}</dd>
          </div>
          <div>
            <dt>mismatch</dt>
            <dd>
              {row.misMatchPercentage.toFixed(2)}% · {row.diffPixels.toLocaleString()} px ·
              threshold {row.threshold.toFixed(2)}%
            </dd>
          </div>
        </>
      }
    />
  );
}

// Group rows for the same selector side-by-side across devices. Sort by
// selector first, then by the test's viewport order (phone → tablet → desktop
// in most configs) so the grid reads left-to-right as "narrower → wider".
function sortBySelectorThenViewport(rows: VisregArtifact[]): VisregArtifact[] {
  // Preserve first-seen viewport order instead of alphabetising (alphabetical
  // would put "desktop" before "phone", inverting the usual narrow→wide read).
  const viewportOrder = new Map<string, number>();
  for (const r of rows) {
    if (!viewportOrder.has(r.viewportLabel)) {
      viewportOrder.set(r.viewportLabel, viewportOrder.size);
    }
  }
  return [...rows].sort((a, b) => {
    if (a.selector !== b.selector) return a.selector.localeCompare(b.selector);
    return (viewportOrder.get(a.viewportLabel) ?? 0) - (viewportOrder.get(b.viewportLabel) ?? 0);
  });
}

export function VisregSlot({ rows = EMPTY, test }: { rows?: VisregArtifact[]; test: TestResult }) {
  const [openRow, setOpenRow] = useState<VisregArtifact | null>(null);

  if (rows.length === 0) {
    return <div className="empty" style={{ padding: '20px 0' }}>no visreg artifacts</div>;
  }

  const sorted = sortBySelectorThenViewport(rows);
  const diffRows = sorted.filter((r) => r.diffImage !== null);
  const noDiffRows = sorted.filter((r) => r.diffImage === null);

  return (
    <div className="visreg">
      {diffRows.map((row) => (
        <DiffCard
          key={`${row.viewportLabel}-${row.selector}`}
          row={row}
          onOpen={setOpenRow}
        />
      ))}
      {noDiffRows.length > 0 ? (
        <div className="visreg__grid">
          {noDiffRows.map((row) => (
            <NoDiffCard
              key={`${row.viewportLabel}-${row.selector}`}
              row={row}
              onOpen={setOpenRow}
            />
          ))}
        </div>
      ) : null}
      <Dialog
        open={openRow !== null}
        onClose={() => setOpenRow(null)}
        title={
          openRow ? (
            <>
              <span className="visreg-dialog__tag">{openRow.viewportLabel}</span>
              <span className="visreg-dialog__tag visreg-dialog__tag--muted">{openRow.selector}</span>
              <span className="visreg-dialog__tag">
                {openRow.diffImage ? `${openRow.misMatchPercentage.toFixed(2)}%` : 'no diff'}
              </span>
            </>
          ) : null
        }
        meta={openRow ? <VisregDialogMeta test={test} row={openRow} /> : null}
      >
        {openRow ? <DialogBody row={openRow} /> : null}
      </Dialog>
    </div>
  );
}
