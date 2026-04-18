import type { VisregArtifact } from '../types';

const EMPTY: VisregArtifact[] = [];

export function VisregSlot({ rows = EMPTY }: { rows?: VisregArtifact[] }) {
  if (rows.length === 0) {
    return <div className="empty" style={{ padding: '20px 0' }}>no visreg artifacts</div>;
  }
  return (
    <div>
      {rows.map((row) => (
        <div key={`${row.viewportLabel}-${row.selector}`} className="viewport-row">
          <div className="viewport-row__label">
            {row.viewportLabel}
            <br />
            <span style={{ color: 'var(--fg-faint)', textTransform: 'none', letterSpacing: 0 }}>
              {row.selector}
            </span>
            <br />
            <span style={{ color: 'var(--fg)', textTransform: 'none', letterSpacing: 0 }}>
              {row.misMatchPercentage.toFixed(2)}%
            </span>
          </div>
          <div className="viewport-row__img" data-kind="control">
            <img src={row.controlImage} alt="control" loading="lazy" />
          </div>
          <div className="viewport-row__img" data-kind="experiment">
            <img src={row.experimentImage} alt="experiment" loading="lazy" />
          </div>
          <div className="viewport-row__img" data-kind="diff">
            {row.diffImage ? <img src={row.diffImage} alt="diff" loading="lazy" /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
