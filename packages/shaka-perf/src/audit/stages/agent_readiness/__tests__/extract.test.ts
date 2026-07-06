/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { extractPageSignals } from '../extract';

function withDocument<T>(bodyText: string, run: () => T): T {
  const prior = (globalThis as { document?: Document }).document;
  const bodyClone = {
    textContent: bodyText,
    querySelectorAll: () => [] as Element[],
  };
  const fakeDocument = {
    title: 'Fixture',
    documentElement: { getAttribute: () => '' },
    body: {
      cloneNode: () => bodyClone,
    },
    querySelector: () => null,
    querySelectorAll: () => [] as Element[],
  } as unknown as Document;

  (globalThis as { document?: Document }).document = fakeDocument;
  try {
    return run();
  } finally {
    if (prior === undefined) delete (globalThis as { document?: Document }).document;
    else (globalThis as { document?: Document }).document = prior;
  }
}

describe('extractPageSignals textSample', () => {
  it('captures the first normal sentence from rendered body text', () => {
    const signals = withDocument(
      'Tiny intro. This product page explains our custom booking workflow for returning enterprise customers. Another sentence appears later.',
      extractPageSignals,
    );

    expect(signals.textSample).toBe(
      'This product page explains our custom booking workflow for returning enterprise customers.',
    );
  });

  it('omits textSample when no sentence has enough words', () => {
    const signals = withDocument('Hi there. Small words only.', extractPageSignals);

    expect(signals.textWords).toBe(5);
    expect('textSample' in signals).toBe(false);
  });
});
