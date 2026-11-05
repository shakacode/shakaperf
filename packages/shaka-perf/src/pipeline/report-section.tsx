/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { ReportHeading } from './report-heading';

const VisibilityContext = createContext<{
  hidden: ReadonlySet<string>;
  toggle: (key: string) => void;
} | null>(null);
const SectionContext = createContext<string | null>(null);

export function ReportSectionVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  return (
    <VisibilityContext.Provider value={{ hidden, toggle: (key) => {
      setHidden((previous) => {
        const next = new Set(previous);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    } }}>
      {children}
    </VisibilityContext.Provider>
  );
}

export function useReportSection(): string | null {
  return useContext(SectionContext);
}

export function ReportSection({ sectionKey, title, children, badge, nested = false }: {
  sectionKey: string;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  nested?: boolean;
}) {
  const visibility = useContext(VisibilityContext);
  const contentId = useId();
  const hidden = visibility?.hidden.has(sectionKey) ?? false;
  const buttonRef = useRef<HTMLButtonElement>(null);


  return (
    <SectionContext.Provider value={sectionKey}>
      <div className={`report-section${nested ? ' report-section--nested' : ''}`} data-report-section={sectionKey} data-hidden={hidden}>
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
              onToggle: () => visibility.toggle(sectionKey),
            } : undefined}
          />
        </div>
        <div id={contentId} className="report-section__body" hidden={hidden}>{children}</div>
      </div>
    </SectionContext.Provider>
  );
}
