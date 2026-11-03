/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const VisibilityContext = createContext<{
  hidden: ReadonlySet<string>;
  toggle: (section: string) => void;
} | null>(null);
const SectionContext = createContext<string | null>(null);

export function ReportSectionVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((section: string) => {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);
  return <VisibilityContext.Provider value={value}>{children}</VisibilityContext.Provider>;
}

export function ReportSectionScope({ section, children }: { section: string; children: ReactNode }) {
  return <SectionContext.Provider value={section}>{children}</SectionContext.Provider>;
}

export function useReportSection(section?: string) {
  const scope = useContext(SectionContext);
  const key = section ?? scope;
  const state = useContext(VisibilityContext);
  return {
    section: key,
    visible: key == null || !state?.hidden.has(key),
    toggle: key != null && state ? () => state.toggle(key) : undefined,
  };
}

export function ReportSectionSwitch({ label, section }: { label: string; section?: string }) {
  const { visible, toggle } = useReportSection(section);
  if (!toggle) return null;
  return (
    <button
      type="button"
      role="switch"
      className="section-switch"
      aria-label={`${label} in all test cards`}
      aria-checked={visible}
      title={`${visible ? 'Hide' : 'Show'} ${label} in all test cards`}
      onClick={toggle}
    >
      <span className="section-switch__thumb" />
    </button>
  );
}
