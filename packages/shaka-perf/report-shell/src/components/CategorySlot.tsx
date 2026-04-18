import type { CategoryResult } from '../types';
import { VisregSlot } from './VisregSlot';
import { PerfSlot } from './PerfSlot';

export function CategorySlot({ result }: { result: CategoryResult }) {
  if (result.category === 'visreg') {
    return <VisregSlot rows={result.visreg ?? []} />;
  }
  if (result.category === 'perf' && result.perf) {
    return <PerfSlot perf={result.perf} />;
  }
  return null;
}
