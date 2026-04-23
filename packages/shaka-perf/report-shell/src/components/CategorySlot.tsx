import { useState } from 'react';
import type { CategoryResult, TestResult } from '../types';
import { VisregSlot } from './VisregSlot';
import { PerfSlot } from './PerfSlot';
import { Dialog } from './Dialog';
import { TestMeta } from './TestMeta';

const LABEL = {
  visreg: 'visreg',
  perf: 'perf',
} as const;

/**
 * Renders the per-category error banner. Clickable when there's a captured
 * engine log — opens a dialog with the transcript (plus stack) so the failure
 * is inspectable from the self-contained report without reaching back to
 * compare-results/<slug>/engine-output.log on disk.
 */
function SlotError({
  result,
  test,
}: {
  result: CategoryResult;
  test: TestResult;
}) {
  const [open, setOpen] = useState(false);
  const hasLog = typeof result.errorLog === 'string' && result.errorLog.length > 0;
  const body = (
    <>
      <span className="slot-error__prefix">{LABEL[result.category]} ·</span>
      <span className="slot-error__message">{result.error}</span>
      {hasLog ? <span className="slot-error__hint">view logs →</span> : null}
    </>
  );

  if (!hasLog) {
    return (
      <div className="slot-error" role="alert">
        {body}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="slot-error slot-error--clickable"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {body}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="ui-dialog__title-text">
            {LABEL[result.category]} · measurement logs
          </span>
        }
        meta={<TestMeta test={test} />}
      >
        <pre className="error-log">{result.errorLog}</pre>
      </Dialog>
    </>
  );
}

export function CategorySlot({ result, test }: { result: CategoryResult; test: TestResult }) {
  if (result.skipped) {
    return (
      <div className="slot-skipped" role="note">
        <span className="slot-skipped__prefix">{LABEL[result.category]} ·</span>
        <span className="slot-skipped__message">skipped for this test (testTypes)</span>
      </div>
    );
  }
  return (
    <div>
      {result.error ? <SlotError result={result} test={test} /> : null}
      {result.category === 'visreg' ? <VisregSlot rows={result.visreg ?? []} test={test} /> : null}
      {result.category === 'perf' && result.perf ? <PerfSlot perf={result.perf} test={test} /> : null}
    </div>
  );
}
