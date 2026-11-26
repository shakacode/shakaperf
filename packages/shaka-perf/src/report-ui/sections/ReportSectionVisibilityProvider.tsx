/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createContext, useContext, useState, type ReactNode } from 'react';

const VisibilityContext = createContext<{
  hidden: ReadonlySet<string>;
  toggle: (key: string) => void;
} | null>(null);

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

export function useReportSectionVisibility() {
  return useContext(VisibilityContext);
}
