/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { VisregSideFailure } from '../../../../visreg/core/side-failure';
import { findVisregFailureScreenshot } from '../failure-screenshot';

let root: string;
let controlPath: string;
let experimentPath: string;
let startedAt: number;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'visreg-failure-'));
  const controlDir = path.join(root, 'control_screenshots');
  const experimentDir = path.join(root, 'experiment_screenshots');
  fs.mkdirSync(controlDir);
  fs.mkdirSync(experimentDir);

  controlPath = path.join(controlDir, 'control.png');
  experimentPath = path.join(experimentDir, 'experiment.png');
  fs.writeFileSync(controlPath, 'control');
  fs.writeFileSync(experimentPath, 'experiment');

  startedAt = Date.now() - 5_000;
  fs.utimesSync(controlPath, new Date(startedAt + 1_000), new Date(startedAt + 1_000));
  fs.utimesSync(experimentPath, new Date(startedAt + 2_000), new Date(startedAt + 2_000));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

it('uses the exact screenshot carried by a side failure', () => {
  const failure = new VisregSideFailure(
    'control',
    new Error('boom'),
    controlPath,
  );

  expect(findVisregFailureScreenshot(failure, root, startedAt)).toBe(controlPath);
});

it('searches only the attributed side through wrapper causes', () => {
  const failure = new Error('wrapper', {
    cause: new VisregSideFailure('control', new Error('boom')),
  });

  expect(findVisregFailureScreenshot(failure, root, startedAt)).toBe(controlPath);
});

it('does not borrow the other side screenshot when the attributed side has none', () => {
  fs.rmSync(controlPath);
  const failure = new VisregSideFailure('control', new Error('boom'));

  expect(findVisregFailureScreenshot(failure, root, startedAt)).toBeUndefined();
});

it('uses the newest screenshot across both sides for unattributed engine errors', () => {
  expect(
    findVisregFailureScreenshot(new Error('engine failed'), root, startedAt),
  ).toBe(experimentPath);
});
