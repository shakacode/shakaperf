import type { CSSProperties } from 'react';
import type { VisregArtifact } from '../types';

const EMPTY: VisregArtifact[] = [];

interface RowProps {
  row: VisregArtifact;
}

function CardHead({ row }: RowProps) {
  return (
    <div className="visreg-card__head">
      <span className="visreg-card__viewport">{row.viewportLabel}</span>
      <span className="visreg-card__selector">{row.selector}</span>
      <span className="visreg-card__pct">{row.misMatchPercentage.toFixed(2)}%</span>
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

function DiffCard({ row }: RowProps) {
  const tripletStyle = tripletVarsFor(row);
  const cls = tripletStyle
    ? 'visreg-card__images visreg-card__images--triplet visreg-card__images--crop'
    : 'visreg-card__images visreg-card__images--triplet';
  const bbox = row.diffBbox;
  return (
    <div className="visreg-card visreg-card--diff">
      <CardHead row={row} />
      <div className={cls} style={tripletStyle}>
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
      </div>
    </div>
  );
}

function NoDiffCard({ row }: RowProps) {
  return (
    <div className="visreg-card visreg-card--nodiff">
      <CardHead row={row} />
      <div className="visreg-card__images">
        <div className="visreg-card__img" data-kind="no-diff">
          <img src={row.controlImage} alt="screenshot" loading="lazy" />
        </div>
      </div>
    </div>
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

export function VisregSlot({ rows = EMPTY }: { rows?: VisregArtifact[] }) {
  if (rows.length === 0) {
    return <div className="empty" style={{ padding: '20px 0' }}>no visreg artifacts</div>;
  }

  const sorted = sortBySelectorThenViewport(rows);
  const diffRows = sorted.filter((r) => r.diffImage !== null);
  const noDiffRows = sorted.filter((r) => r.diffImage === null);

  return (
    <div className="visreg">
      {diffRows.map((row) => (
        <DiffCard key={`${row.viewportLabel}-${row.selector}`} row={row} />
      ))}
      {noDiffRows.length > 0 ? (
        <div className="visreg__grid">
          {noDiffRows.map((row) => (
            <NoDiffCard key={`${row.viewportLabel}-${row.selector}`} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
