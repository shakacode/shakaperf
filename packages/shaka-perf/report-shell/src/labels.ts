import type { Status } from './types';

export const STATUS_ORDER: Status[] = [
  'error',
  'regression',
  'visual_change',
  'improvement',
  'no_difference',
];

export const STATUS_LABEL: Record<Status, string> = {
  error: 'measurement errors',
  regression: 'performance regressions',
  visual_change: 'visual changes',
  improvement: 'performance improvements',
  no_difference: 'no diff',
};
