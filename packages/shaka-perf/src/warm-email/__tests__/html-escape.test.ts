/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by the license in LICENSE.md.
 */

import { escapeHtml } from '../html-escape';

describe('escapeHtml', () => {
  it('escapes every HTML-special character', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes ampersands first without double-escaping generated entities', () => {
    expect(escapeHtml('&<')).toBe('&amp;&lt;');
  });
});
