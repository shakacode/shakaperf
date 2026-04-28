import type { TestResult } from '../types';

/**
 * Compact summary tile shown only in `--report-only` mode, listing every
 * test that has no per-test artifacts on disk (`measuredAt === null`).
 * Without this bucket those tests would render as empty "no_difference"
 * cards and pollute the default view; pooling them lets the user quickly
 * see which measurements still need to be shipped into the merged tree.
 */
export function MissingArtifactsCard({ tests }: { tests: TestResult[] }) {
  if (tests.length === 0) return null;
  return (
    <article className="card card--missing-artifacts" data-status="no_difference">
      <div className="card__head">
        <div>
          <h3 className="card__title">no artifacts yet</h3>
        </div>
      </div>
      <div className="missing-artifacts__summary">
        {tests.length} test{tests.length === 1 ? '' : 's'} missing on-disk measurements —
        re-run `shaka-perf compare` (or ship the shard that measures them)
      </div>
      <ul className="missing-artifacts__list">
        {tests.map((t) => (
          <li key={t.id} className="missing-artifacts__item">
            <span className="missing-artifacts__name">{t.name}</span>
            <span className="missing-artifacts__path">{t.filePath}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
