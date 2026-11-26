/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { ReportHeading, type ReportHeadingProps } from '../sections/ReportHeading';
import { useReportSection } from '../sections/ReportSection';

export function StageArtifactTitle(
  { title, badge, verbatim = false }: Pick<ReportHeadingProps, 'title' | 'badge'> & { verbatim?: boolean },
) {
  const section = useReportSection();
  // The enclosing report section owns the main heading. Subsections use
  // ReportHeading directly, independently of the title's JSX structure.
  if (section != null) return null;
  // `verbatim` opts out of the default uppercase transform so human-readable
  // multi-word titles (e.g. compare section headings) keep their own casing.
  const className = verbatim
    ? 'stage-artifact__title stage-artifact__title--verbatim'
    : 'stage-artifact__title';
  return <ReportHeading className={className} title={title} badge={badge} />;
}
