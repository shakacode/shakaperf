/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

export function StageNote({ body, label }: { body: string; label?: string }) {
  return (
    <div className="stage-note">
      {label ? <span className="stage-note__label">{label}</span> : null}
      <span className="stage-note__body">{body}</span>
    </div>
  );
}
