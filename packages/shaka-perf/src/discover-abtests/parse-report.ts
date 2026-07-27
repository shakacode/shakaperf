/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';

interface Pair {
  status?: string;
  diff?: { misMatchPercentage?: number | string };
  label?: string;
  fileName?: string;
  testWhitePixelPercent?: number;
  refWhitePixelPercent?: number;
  testIsBottomSeventyPercentWhite?: boolean;
  refIsBottomSeventyPercentWhite?: boolean;
  error?: string;
}

interface Test {
  status?: string;
  pair?: Pair;
}

interface Report {
  tests?: Test[];
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

export function parseReport(reportPath: string): void {
  if (!fs.existsSync(reportPath)) {
    console.error(`Report not found: ${reportPath}`);
    process.exitCode = 1;
    return;
  }

  let data: Report;
  try {
    data = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Report;
  } catch (error) {
    console.error(`Failed to read or parse report ${reportPath}: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const tests = data.tests ?? [];
  if (tests.length === 0) {
    console.log('No tests found in report.');
    return;
  }

  let passCount = 0;
  let failCount = 0;
  let otherCount = 0;
  let highWhiteCount = 0;
  let engineErrorCount = 0;
  let bottomWhiteCount = 0;

  console.log(
    `${pad('STATUS', 10)} ${pad('DIFF %', 10)} ${pad('WHITE%', 10)} ${pad('BOT70W', 8)} ${pad('ERROR', 8)} LABEL`,
  );
  console.log('-'.repeat(90));

  for (const t of tests) {
    const pair = t.pair ?? {};
    const status = t.status ?? pair.status ?? 'unknown';
    const diffPct = pair.diff?.misMatchPercentage ?? 'n/a';
    const label = pair.label ?? pair.fileName ?? 'unknown';

    const whitePct = pair.testWhitePixelPercent ?? pair.refWhitePixelPercent;
    const whiteStr = whitePct !== undefined ? `${whitePct.toFixed(1)}%` : 'n/a';
    const bot70 = pair.testIsBottomSeventyPercentWhite ?? pair.refIsBottomSeventyPercentWhite;
    const bot70Str = bot70 === undefined ? 'n/a' : String(bot70);

    const hadError = typeof pair.error === 'string' && pair.error.length > 0;
    const errorStr = hadError ? 'YES' : '';

    const flags: string[] = [];
    if (whitePct !== undefined && whitePct > 90) {
      flags.push('HIGH-WHITE');
      highWhiteCount++;
    }
    if (hadError) {
      flags.push('ENGINE-ERR');
      engineErrorCount++;
    }
    if (bot70 === true) bottomWhiteCount++;

    const flagStr = flags.length > 0 ? `  <- ${flags.join(', ')}` : '';

    console.log(
      `${pad(status, 10)} ${pad(`${diffPct}%`, 10)} ${pad(whiteStr, 10)} ${pad(bot70Str, 8)} ${pad(errorStr, 8)} ${label}${flagStr}`,
    );

    if (status === 'pass') passCount++;
    else if (status === 'fail') failCount++;
    else otherCount++;
  }

  console.log('-'.repeat(90));
  console.log(
    `Total: ${tests.length}  Pass: ${passCount}  Fail: ${failCount}  Other: ${otherCount}`,
  );

  if (highWhiteCount > 0) {
    console.log(
      `WARNINGS: ${highWhiteCount} test(s) with whitePixelPercent > 90% (selector may capture empty space)`,
    );
  }
  if (engineErrorCount > 0) {
    console.log(`ERRORS: ${engineErrorCount} test(s) with engine error (check the pair's \`error\`)`);
  }
  if (bottomWhiteCount > 0) {
    console.log(`INFO: ${bottomWhiteCount} test(s) with bottom 70% white (content concentrated at top)`);
  }
}
