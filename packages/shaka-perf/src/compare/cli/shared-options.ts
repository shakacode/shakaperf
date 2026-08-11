/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { Command, Option } from 'commander';
import { getCLIDefaultsFromConfig } from '../../cli-defaults';
import { comparePipelineMetadata } from '../compare-pipeline';

export interface CompareMeasurementOptionDefaults {
  controlURL: string;
  experimentURL: string;
}

interface AddCompareMeasurementOptionsInput {
  defaults?: CompareMeasurementOptionDefaults;
  categoriesDefault?: string;
}

export async function getCompareMeasurementOptionDefaults(
  argv: string[],
): Promise<CompareMeasurementOptionDefaults | undefined> {
  return getCLIDefaultsFromConfig(argv, (config) => ({
    controlURL: config.shared.controlURL,
    experimentURL: config.shared.experimentURL,
  }));
}

export function addCompareMeasurementOptions(
  command: Command,
  input: AddCompareMeasurementOptionsInput = {},
): Command {
  const categories = new Option(
    '--categories <list>',
    `Comma-separated list of categories (${comparePipelineMetadata.categories.join(', ')})`,
  );
  if (input.categoriesDefault !== undefined) {
    categories.default(input.categoriesDefault);
  }

  const options = [
    categories,
    new Option('-c, --config <path>', 'Path to abtests.config.ts (default: cwd lookup)'),
    new Option(
      '--filter <value>',
      'Regex/substring to filter tests by name (comma-separated for multiple), OR a path to a single .abtest.ts/.abtest.js file',
    ),
    new Option(
      '--testPathPattern <regex>',
      'Regex pattern to filter discovered .abtest.ts/.abtest.js files (like Jest)',
    ),
    new Option(
      '--headed',
      'Launch the measurement browser headed (visible window) instead of headless. Off by default.',
    ).default(false),
    new Option('--controlURL <url>', 'Control server URL').default(input.defaults?.controlURL),
    new Option('--experimentURL <url>', 'Experiment server URL')
      .default(input.defaults?.experimentURL),
  ];

  for (const option of options) command.addOption(option);
  return command;
}
