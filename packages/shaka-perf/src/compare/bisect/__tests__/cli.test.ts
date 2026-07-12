/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { createCompareCommand } from '../../cli/program';

describe('compare bisect command', () => {
  it('registers optional refs without replacing the compare action', async () => {
    const compare = await createCompareCommand();

    expect(compare.commands.map((command) => command.name())).toContain('bisect');
    expect(compare.registeredArguments).toHaveLength(0);
    expect((compare as unknown as { _actionHandler?: unknown })._actionHandler).toEqual(expect.any(Function));

    const bisect = compare.commands.find((command) => command.name() === 'bisect')!;
    expect(bisect.registeredArguments.map((argument) => argument.name())).toEqual([
      'good-ref',
      'bad-ref',
    ]);
  });
});
