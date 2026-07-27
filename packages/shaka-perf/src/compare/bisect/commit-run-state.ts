/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BisectSession, CommitRun } from './types';

export function installCommitRun(session: BisectSession, commitRun: CommitRun): BisectSession {
  const repairApplications = session.repairApplications.filter((application) => (
    application.evaluationId !== commitRun.repairEvidence.evaluationId
  ));
  repairApplications.push(commitRun.repairEvidence);
  return {
    ...session,
    repairApplications,
    commitRuns: {
      ...session.commitRuns,
      [commitRun.sha]: commitRun,
    },
  };
}
