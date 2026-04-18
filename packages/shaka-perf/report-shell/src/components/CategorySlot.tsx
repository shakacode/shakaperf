import type { CategoryResult } from '../types';
import { VisregSlot } from './VisregSlot';
import { PerfSlot } from './PerfSlot';

const LABEL = {
  visreg: 'visreg',
  perf: 'perf',
} as const;

export function CategorySlot({ result }: { result: CategoryResult }) {
  return (
    <div>
      {result.error ? (
        <div className="slot-error" role="alert">
          <span className="slot-error__prefix">{LABEL[result.category]} ·</span>
          <span className="slot-error__message">{result.error}</span>
        </div>
      ) : null}
      {result.category === 'visreg' ? <VisregSlot rows={result.visreg ?? []} /> : null}
      {result.category === 'perf' && result.perf ? <PerfSlot perf={result.perf} /> : null}
    </div>
  );
}
