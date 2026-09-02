/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { shellQuote } from '../shell-command';
import { comparePipelineReport } from '../compare/pipeline-report';
import { auditPipelineReport } from '../audit/pipeline-report';
import { pipelineTroubleshootCommands } from '../pipeline/pipeline-artifacts';

describe('shellQuote', () => {
  it('quotes a name with spaces and punctuation so it pastes as one argument', () => {
    expect(shellQuote('Product Details => Click on Reviews'))
      .toBe(`'Product Details => Click on Reviews'`);
  });

  it('survives a name containing a single quote', () => {
    expect(shellQuote("Cart's drawer")).toBe(`'Cart'\\''s drawer'`);
  });
});

describe('pipelineTroubleshootCommands', () => {
  const meta = (pipelineName: string) => ({
    pipelineName,
    pipelineConfig: { parallelism: 1 },
  } as unknown as Parameters<typeof pipelineTroubleshootCommands>[0]);

  it('gives compare one command per viewport', () => {
    expect(pipelineTroubleshootCommands(meta('compare'), 'Cart', ['desktop', 'phone'])).toEqual([
      `shaka-perf troubleshoot --filter 'Cart' --viewport desktop`,
      `shaka-perf troubleshoot --filter 'Cart' --viewport phone`,
    ]);
  });

  it('points an audit at the same command — the tests are the same files', () => {
    expect(pipelineTroubleshootCommands(meta('audit'), 'Cart', ['desktop', 'phone'])).toEqual([
      `shaka-perf troubleshoot --filter 'Cart' --viewport desktop`,
      `shaka-perf troubleshoot --filter 'Cart' --viewport phone`,
    ]);
  });
});

describe('troubleshoot commands', () => {
  it('names the one test and the one viewport for compare', () => {
    expect(comparePipelineReport.troubleshootCommand!('Cart Drawer', 'phone'))
      .toBe(`shaka-perf troubleshoot --filter 'Cart Drawer' --viewport phone`);
  });

  it('gives an audit the same command as a comparison', () => {
    expect(auditPipelineReport.troubleshootCommand!('Homepage', 'desktop'))
      .toBe(`shaka-perf troubleshoot --filter 'Homepage' --viewport desktop`);
  });
});
