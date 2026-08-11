/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Runs security-checks/sync-npm-shrinkwrap.mjs after local Yarn installs,
// so npm-shrinkwrap.json follows yarn.lock automatically during dependency work.
// CI must validate the reviewed shrinkwrap, never regenerate it.
//
// This lives in a plugin rather than a workspace `postinstall` because those two
// hooks fire at different times. Yarn writes yarn.lock during resolution but
// only runs a workspace's postinstall when the LINK step decides that workspace
// needs rebuilding. Those are independent: a `yarn` that changes yarn.lock
// without triggering a rebuild would update one lockfile and silently skip the
// other. `afterAllInstalled` fires on every install, rebuild or not.

const shouldSyncNpmShrinkwrap = (env) => {
  const isCI = env.CI && !['0', 'false'].includes(env.CI.toLowerCase());
  return !isCI;
};

const supportsNpmVersion = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major > 11 || (major === 11 && (minor > 6 || (minor === 6 && patch >= 3)));
};

module.exports = {
  name: 'plugin-sync-npm-shrinkwrap',
  shouldSyncNpmShrinkwrap,
  supportsNpmVersion,
  factory: (require) => {
    const { execFileSync } = require('child_process');
    const path = require('path');

    return {
      hooks: {
        afterAllInstalled: (project) => {
          if (!shouldSyncNpmShrinkwrap(process.env)) return;
          const root = project.cwd;
          const script = path.join(root, 'security-checks', 'sync-npm-shrinkwrap.mjs');
          // Errors are not swallowed: a failed refresh means the two lockfiles
          // have drifted, and the next commit would ship that.
          execFileSync(process.execPath, [script], { cwd: root, stdio: 'inherit' });
        },
      },
    };
  },
};
