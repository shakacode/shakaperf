/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Runs packages/shaka-perf/scripts/sync-npm-lock.mjs after every Yarn install,
// so npm-shrinkwrap.json follows yarn.lock automatically.
//
// This lives in a plugin rather than a workspace `postinstall` because those two
// hooks fire at different times. Yarn writes yarn.lock during resolution but
// only runs a workspace's postinstall when the LINK step decides that workspace
// needs rebuilding. Those are independent: a `yarn` that changes yarn.lock
// without triggering a rebuild would update one lockfile and silently skip the
// other. `afterAllInstalled` fires on every install, rebuild or not.

module.exports = {
  name: 'plugin-sync-npm-lock',
  factory: (require) => {
    const { execFileSync } = require('child_process');
    const path = require('path');

    return {
      hooks: {
        afterAllInstalled: (project) => {
          const root = project.cwd;
          const script = path.join(root, 'packages', 'shaka-perf', 'scripts', 'sync-npm-lock.mjs');
          // Errors are not swallowed: a failed refresh means the two lockfiles
          // have drifted, and the next commit would ship that.
          execFileSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
        },
      },
    };
  },
};
