import { useState } from 'react';
import type { Status, TestResult } from '../types';
import { Pill } from './Pill';
import { CategorySlot } from './CategorySlot';

interface PillSpec {
  status: Status;
  detail?: string;
}

function pillsForTest(test: TestResult): PillSpec[] {
  // A single test can emit several pills at once: each category that errored
  // contributes an `errored` pill, and each perf category contributes a
  // separate `regressed` / `improved` pill when its metric set is non-empty —
  // the two are not mutually exclusive. Visreg contributes a `visual change`
  // pill when its pairs actually mismatched.
  const pills: PillSpec[] = [];
  for (const c of test.categories) {
    if (c.error) {
      pills.push({ status: 'error', detail: c.category });
    }
    if (c.category === 'perf' && c.perf) {
      if (c.perf.regressedMetrics.length > 0) {
        pills.push({ status: 'regression', detail: c.perf.regressedMetrics.join(', ') });
      }
      if (c.perf.improvedMetrics.length > 0) {
        pills.push({ status: 'improvement', detail: c.perf.improvedMetrics.join(', ') });
      }
    }
    if (c.category === 'visreg' && c.status === 'visual_change') {
      pills.push({ status: 'visual_change' });
    }
  }
  return pills.length > 0 ? pills : [{ status: 'no_difference' }];
}

export function TestCard({ test, animationDelayMs }: { test: TestResult; animationDelayMs: number }) {
  const [codeOpen, setCodeOpen] = useState(false);
  const pills = pillsForTest(test);

  return (
    <article
      className="card"
      data-status={test.status}
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="card__head">
        <div>
          <h3 className="card__title">{test.name}</h3>
          <div className="card__path">{test.filePath}</div>
        </div>
        <div className="card__pills">
          {pills.map((p, i) => (
            <Pill key={`${p.status}-${i}`} status={p.status} detail={p.detail} />
          ))}
        </div>
      </div>

      <dl className="card__urls">
        <div>
          <dt>control</dt>
          <dd>
            <a href={test.controlUrl} target="_blank" rel="noreferrer">
              {test.controlUrl}
            </a>
          </dd>
        </div>
        <div>
          <dt>experiment</dt>
          <dd>
            <a href={test.experimentUrl} target="_blank" rel="noreferrer">
              {test.experimentUrl}
            </a>
          </dd>
        </div>
      </dl>

      <div className="card__body">
        {test.categories.map((c) => (
          <CategorySlot key={c.category} result={c} test={test} />
        ))}

        {test.code ? (
          <div>
            <button
              type="button"
              className="card__code-toggle"
              onClick={() => setCodeOpen((prev) => !prev)}
              aria-expanded={codeOpen}
            >
              {codeOpen ? '▾ test source' : '▸ test source'}
            </button>
            {codeOpen ? <pre className="card__code">{test.code}</pre> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
