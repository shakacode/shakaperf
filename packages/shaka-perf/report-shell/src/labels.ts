import type { Status } from './types';

export const STATUS_ORDER: Status[] = [
  'error',
  'regression',
  'visual_change',
  'a11y_violation',
  'improvement',
  'no_difference',
];

export const STATUS_LABEL: Record<Status, string> = {
  error: 'measurement errors',
  regression: 'performance regressions',
  visual_change: 'visual changes',
  a11y_violation: 'a11y violations',
  improvement: 'performance improvements',
  no_difference: 'no diff',
};
