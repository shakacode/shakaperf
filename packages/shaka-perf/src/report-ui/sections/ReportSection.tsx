/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { ReportHeading } from './ReportHeading';
import { useReportSectionVisibility } from './ReportSectionVisibilityProvider';

const SectionContext = createContext<string | null>(null);

export function useReportSection(): string | null {
  return useContext(SectionContext);
}

export function ReportSection({ sectionKey, title, children, badge, actions, nested = false }: {
  sectionKey: string;
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  nested?: boolean;
}) {
  const visibility = useReportSectionVisibility();
  const contentId = useId();
  const hidden = visibility?.hidden.has(sectionKey) ?? false;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const scrollPending = useRef(false);

  useEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    const frame = requestAnimationFrame(() => {
      const button = buttonRef.current;
      // A subsequent interaction owns focus and must not be interrupted.
      if (!button || document.activeElement !== button) return;
      button.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [hidden]);

  return (
    <SectionContext.Provider value={sectionKey}>
      <div
        className={`report-section${nested ? ' report-section--nested' : ''}`}
        data-report-section={sectionKey}
        data-hidden={hidden}
      >
        <div className="report-section__head">
          <ReportHeading
            title={title}
            badge={badge}
            className="report-section__title"
            level={nested ? 5 : 4}
            disclosure={visibility ? {
              label: title,
              controls: contentId,
              expanded: !hidden,
              buttonRef,
              onToggle: () => {
                buttonRef.current?.focus({ preventScroll: true });
                scrollPending.current = true;
                visibility.toggle(sectionKey);
              },
            } : undefined}
          />
          {hidden ? null : actions}
        </div>
        <div id={contentId} className="report-section__body" hidden={hidden}>{children}</div>
      </div>
    </SectionContext.Provider>
  );
}
