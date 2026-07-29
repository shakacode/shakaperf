#!/usr/bin/env node
/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */


import { Command } from 'commander';
import { createAuditCommand } from './audit/program';
import { createServersCommand } from './twin-servers/program';
import { createCompareCommand } from './compare/cli/program';
import { createInitCommand } from './compare/cli/init';
import { getCLIDefaultsFromConfig } from './cli-defaults';
import { createDiscoverAbtestsCommand } from './discover-abtests/cli/program';
import { createProcessesCommand, markCurrentProcess } from './processes/program';
import { createWarmEmailCommand } from './warm-email/program';
import { createColdEmailCommand } from './cold-email/program';
import { createClientReportCommand } from './warm-email/client-report-program';

const { version } = require('../package.json');

markCurrentProcess();

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('shaka-perf')
    .description('Frontend performance testing toolkit for web applications')
    .version(`shaka-perf v${version}`, '--version', 'Show version');

  const auditURLDefault = await getCLIDefaultsFromConfig(
    process.argv,
    (c) => c.shared.experimentURL,
  );
  const compareCmd = await createCompareCommand();
  const auditCmd = createAuditCommand({ urlDefault: auditURLDefault });

  for (const cmd of [
    createInitCommand(),
    compareCmd,
    auditCmd,
    createDiscoverAbtestsCommand(),
    createServersCommand(),
    createProcessesCommand(),
    createWarmEmailCommand(),
    createColdEmailCommand(),
    createClientReportCommand(),
  ]) {
    program.addCommand(cmd);
  }

  await program.parseAsync();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
