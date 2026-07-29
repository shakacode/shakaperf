/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { extractPageSignals } from '../extract';

interface FakeBodyNode {
  tag: string;
  text: string;
  removed?: boolean;
}

function withDocument<T>(nodes: FakeBodyNode[], run: () => T): T {
  const prior = (globalThis as { document?: Document }).document;
  const bodyClone = {
    get textContent() {
      return nodes.filter((node) => !node.removed).map((node) => node.text).join(' ');
    },
    querySelectorAll: (selector: string) => {
      const tags = new Set(selector.split(',').map((tag) => tag.trim().toLowerCase()));
      return nodes
        .filter((node) => tags.has(node.tag.toLowerCase()))
        .map((node) => ({
          remove: () => {
            node.removed = true;
          },
        })) as unknown as Element[];
    },
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
      [
        { tag: 'script', text: 'This script sentence should never appear in the extracted visible text sample.' },
        { tag: 'style', text: 'This style sentence should never appear in the extracted visible text sample.' },
        { tag: 'p', text: 'Tiny intro. This product page explains our custom booking workflow for returning enterprise customers. Another sentence appears later.' },
      ],
      extractPageSignals,
    );

    expect(signals.textSample).toBe(
      'This product page explains our custom booking workflow for returning enterprise customers.',
    );
  });

  it('keeps decimal prices and common abbreviations inside the text sample sentence', () => {
    const signals = withDocument(
      [
        { tag: 'p', text: 'Save $3.50 on the basic plan, e.g. shipping to U.S. customers is included today.' },
      ],
      extractPageSignals,
    );

    expect(signals.textSample).toBe(
      'Save $3.50 on the basic plan, e.g. shipping to U.S. customers is included today.',
    );
  });

  it('omits textSample when no sentence has enough words', () => {
    const signals = withDocument([{ tag: 'p', text: 'Hi there. Small words only.' }], extractPageSignals);

    expect(signals.textWords).toBe(5);
    expect('textSample' in signals).toBe(false);
  });
});
