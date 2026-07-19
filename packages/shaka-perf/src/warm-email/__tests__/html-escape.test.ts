/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
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
