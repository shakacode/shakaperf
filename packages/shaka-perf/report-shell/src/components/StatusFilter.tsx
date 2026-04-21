import type { Status } from '../types';
import { STATUS_LABEL, STATUS_ORDER } from '../labels';

interface Props {
  active: Set<Status>;
  counts: Record<Status, number>;
  onToggle: (status: Status) => void;
}

export function StatusFilter({ active, counts, onToggle }: Props) {
  return (
    <div className="filterbar">
      {STATUS_ORDER.map((status) => (
        <button
          key={status}
          type="button"
          data-active={active.has(status) ? 'true' : 'false'}
          onClick={() => onToggle(status)}
        >
          {STATUS_LABEL[status]} · {counts[status]}
        </button>
      ))}
    </div>
  );
}
