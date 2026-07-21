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
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('keeps deprecated --design hidden from help', () => {
    expect(command().helpInformation()).not.toContain('--design');
  });

  it('accepts old --design v2 invocations without enabling the old selector', () => {
    const cmd = command();

    cmd.parse(['--design', 'v2', '--no-ai-narrative'], { from: 'user' });

    expect(cmd.opts()).toMatchObject({ design: 'v2', aiNarrative: false });
    expect(clientReportNarrativeOpts(cmd.opts())).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith('--design v2 is deprecated; client-report now always renders the current report.');
  });

  it('accepts old --design v1 invocations on the current renderer', () => {
    const cmd = command();

    cmd.parse(['--design', 'v1'], { from: 'user' });

    expect(cmd.opts().design).toBe('v1');
    expect(warnSpy).toHaveBeenCalledWith('--design v1 is deprecated; client-report now always renders the current report.');
  });

  it('still rejects invalid --design values', () => {
    expect(() => command().parse(['--design', 'next'], { from: 'user' })).toThrow();
  });

  it('offers an optional money-page path for the booking-line override', () => {
    const option = createClientReportCommand().options.find((candidate) => candidate.long === '--money-page');
    expect(option?.mandatory).toBe(false);
    expect(option?.required).toBe(true);
  });
});
