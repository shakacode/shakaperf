import type { Status } from '../types';

const STATUS_LABEL: Record<Status, string> = {
  regression: 'regressed',
  visual_change: 'visual change',
  improvement: 'improved',
  no_difference: 'no diff',
};

export function Pill({ status, detail }: { status: Status; detail?: string }) {
  return (
    <span className={`pill pill--${status}`}>
      <span className="pill__label">{STATUS_LABEL[status]}</span>
      {detail ? (
        <>
          <span className="pill__sep">:&nbsp;</span>
          <span className="pill__detail">{detail}</span>
        </>
      ) : null}
    </span>
  );
}
