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
 * Consumed by CSS inside `.visreg-card__images--crop` to scale+offset the
 * image inside its container so the first-diff bbox fills the card.
 * Scaling via CSS vars + calc keeps all three triplet images in sync.
 */
function cropVarsFor(row: VisregArtifact): CSSProperties | undefined {
  const b = row.diffBbox;
  if (!b) return undefined;
  return {
    ['--crop-x' as string]: b.x,
    ['--crop-y' as string]: b.y,
    ['--crop-w' as string]: b.w,
    ['--crop-h' as string]: b.h,
    ['--img-w' as string]: b.imgW,
    ['--img-h' as string]: b.imgH,
  };
}

function DiffCard({ row }: RowProps) {
  const style = cropVarsFor(row);
  const cls = style
    ? 'visreg-card__images visreg-card__images--triplet visreg-card__images--crop'
    : 'visreg-card__images visreg-card__images--triplet';
  return (
    <div className="visreg-card visreg-card--diff">
      <CardHead row={row} />
      <div className={cls} style={style}>
        <div className="visreg-card__img" data-kind="control">
          <img src={row.controlImage} alt="control" loading="lazy" />
        </div>
        <div className="visreg-card__img" data-kind="experiment">
          <img src={row.experimentImage} alt="experiment" loading="lazy" />
        </div>
        <div className="visreg-card__img" data-kind="diff">
          <img src={row.diffImage!} alt="diff" loading="lazy" />
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

export function VisregSlot({ rows = EMPTY }: { rows?: VisregArtifact[] }) {
  if (rows.length === 0) {
    return <div className="empty" style={{ padding: '20px 0' }}>no visreg artifacts</div>;
  }

  const diffRows = rows.filter((r) => r.diffImage !== null);
  const noDiffRows = rows.filter((r) => r.diffImage === null);

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
