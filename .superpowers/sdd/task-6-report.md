## 2026-07-12 Task 6 repair

### Files

- `packages/shaka-perf/src/twin-servers/commands/bisect-session.ts`
- `packages/shaka-perf/src/twin-servers/helpers/overmind-processes.ts`
- `packages/shaka-perf/src/twin-servers/helpers/docker.ts`
- `packages/shaka-perf/src/twin-servers/commands/servers-menu.ts`
- `packages/shaka-perf/src/twin-servers/ipc/protocol.ts`
- `packages/shaka-perf/src/twin-servers/ipc/client.ts`
- `packages/shaka-perf/src/twin-servers/ipc/dispatch.ts`
- `packages/shaka-perf/src/twin-servers/ipc/server.ts`
- `packages/shaka-perf/src/twin-servers/__tests__/bisect-session.test.ts`
- `packages/shaka-perf/src/twin-servers/ipc/__tests__/ipc.test.ts`
- `packages/shaka-perf/src/compare/bisect/session.ts`

### Implementation

- Added a PID-owned bisect lease with positive-integer validation and abandoned-owner recovery.
- Added Procfile discovery, targeted experiment-only Overmind stop/restart, and experiment-only readiness polling with a settle probe.
- Added experiment-only image build/container recreation and experiment setup-command execution without stopping, rebuilding, or recreating control.
- Moved command-mode fallback into the menu controller so command or readiness failure triggers the container path exactly once and returns `BisectRefreshResult`.
- Added typed IPC response data, `requireBisectProxy`, `sessionId`/`rebuildCommands` request fields, and protocol version 2.
- Kept checkout and volume synchronization in the compare orchestrator while the lease pauses menu auto-sync and competing lifecycle actions.

### TDD and verification

- RED: `yarn workspace shaka-perf test packages/shaka-perf/src/twin-servers/__tests__/bisect-session.test.ts packages/shaka-perf/src/twin-servers/ipc/__tests__/ipc.test.ts --runInBand`
  - Failed before implementation on missing `bisect-session`, `overmind-processes`, `recreateExperimentContainer`, `requireBisectProxy`, and the old token/void IPC shapes.
- GREEN: same focused command.
  - PASS: 2 suites, 23 tests.
- `yarn workspace shaka-perf test packages/shaka-perf/src/compare/bisect/__tests__/session.test.ts --runInBand`
  - PASS: 1 suite, 3 tests.
- `yarn workspace shaka-perf run typecheck`
  - PASS after building the fresh worktree's `shaka-shared` dependency with `yarn workspace shaka-shared build`.
- `git diff --check`
  - PASS.

### Concerns

- Typed response data required a minimal `ipc/server.ts` transport change even though that file was omitted from the brief's file list; without it the required `ProxyResponse.data` cannot cross the socket.
- No live twin-server acceptance was run because the controller's existing menu used the pre-bump protocol while concurrent acceptance owned the shared checkout; focused tests cover exact process/container targets and typed transport.
