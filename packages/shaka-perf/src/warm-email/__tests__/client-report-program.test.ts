/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command } from 'commander';

import { addClientReportNarrativeOption, clientReportNarrativeOpts, createClientReportCommand } from '../client-report-program';

function command(): Command {
  return addClientReportNarrativeOption(new Command('report').exitOverride()).configureOutput({
    writeErr: () => {},
  });
}

describe('client report program options', () => {
  // `--design` was removed along with the old renderer; it is no longer
  // accepted in any form.
  it('rejects the removed --design option', () => {
    expect(() => command().parse(['--design', 'v2'], { from: 'user' })).toThrow();
  });

  it('disables the AI narrative pass with --no-ai-narrative', () => {
    const cmd = command();

    cmd.parse(['--no-ai-narrative'], { from: 'user' });

    expect(cmd.opts()).toMatchObject({ aiNarrative: false });
    expect(clientReportNarrativeOpts(cmd.opts())).toEqual({});
  });

  it('offers an optional money-page path for the booking-line override', () => {
    const option = createClientReportCommand().options.find((candidate) => candidate.long === '--money-page');
    expect(option?.mandatory).toBe(false);
    expect(option?.required).toBe(true);
  });
});
