import type { Status } from '../types';

const ORDER: Status[] = ['regression', 'visual_change', 'improvement', 'no_difference'];
const LABEL: Record<Status, string> = {
  regression: 'regressions',
  visual_change: 'visual',
  improvement: 'improvements',
  no_difference: 'no diff',
};

interface Props {
  active: Set<Status>;
  counts: Record<Status, number>;
  onToggle: (status: Status) => void;
}

export function StatusFilter({ active, counts, onToggle }: Props) {
  return (
    <div className="filterbar">
      {ORDER.map((status) => (
        <button
          key={status}
          type="button"
          data-active={active.has(status) ? 'true' : 'false'}
          onClick={() => onToggle(status)}
        >
          {LABEL[status]} · {counts[status]}
        </button>
      ))}
    </div>
  );
}
