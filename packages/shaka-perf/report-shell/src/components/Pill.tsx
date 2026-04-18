import type { Status } from '../types';

const STATUS_LABEL: Record<Status, string> = {
  regression: 'regression',
  visual_change: 'visual change',
  improvement: 'improvement',
  no_difference: 'no diff',
};

export function Pill({ status }: { status: Status }) {
  return <span className={`pill pill--${status}`}>{STATUS_LABEL[status]}</span>;
}
