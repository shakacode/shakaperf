# shaka-perf twin-servers

Docker-based A/B performance testing infrastructure. Runs two identical servers side-by-side — a **control** (baseline branch) and an **experiment** (your branch) — so you can measure the performance impact of your changes.

> **First time?** See [SETUP-twin-servers.md](./SETUP-twin-servers.md) for step-by-step instructions on adding twin-servers to your project.

## Usage

The fast path: one command detects whether the Docker images are stale (mtime
of any non-`.dockerignore`d file in the build context vs the image's creation
time), rebuilds if needed, starts containers, then starts servers.

```bash
cd your-app

# Detect changes → rebuild if needed → start containers → start servers
yarn shaka-perf servers

# Visit:
#   Control:    http://localhost:3020
#   Experiment: http://localhost:3030
```

Need finer-grained control? Each step is a subcommand:

```bash
yarn shaka-perf servers build              # Build both Docker images
yarn shaka-perf servers start-containers   # Start containers
yarn shaka-perf servers start-servers      # Start servers via Overmind
```

### Iterating on Changes

Docker volumes are bind-mounted to host directories, so you can sync changes without rebuilding images:

* Stop servers (Ctrl+C on Overmind)
* `yarn shaka-perf servers sync-changes experiment`
* `yarn shaka-perf servers run-cmd experiment "bundle exec rake assets:precompile"`
* `yarn shaka-perf servers start-servers`

### Stop Everything (shut down docker containers)

```bash
yarn shaka-perf servers stop-containers
```

## Architecture

### Control vs Experiment

- **Control:** Built from the baseline branch (typically `main`). This is your reference point.
- **Experiment:** Built from your current branch. This is what you're measuring.

Both run in **production mode**. The only difference is the `PERF_EXPERIMENT` environment variable (`"false"` for control, `"true"` for experiment).

### Ports

| Service           | Host | Container |
|-------------------|------|-----------|
| Control server    | 3020 | 3000      |
| Experiment server | 3030 | 3000      |

The host ports above are the defaults assigned in the generated
`abtests.config.ts`:

1. **`SHAKAPERF_CONTROL_PORT` / `SHAKAPERF_EXPERIMENT_PORT`** — pin an exact
   pair (e.g. in CI). Both must be set; a lone one is ignored.
2. **`CONDUCTOR_PORT`** (exported per workspace by
   [Conductor.build](https://conductor.build)) — the first of [10 consecutive
   ports the workspace owns exclusively](https://docs.conductor.build/tips/conductor-env);
   the template takes control = base, experiment = base + 1, so concurrent
   agents in separate workspaces never collide. This lives in the template, not
   in shaka-perf: the config is plain TypeScript, so any other per-machine
   override is a one-liner you write there yourself.
3. **Otherwise `assignPortsAutomatically`** — start from the preferred pair
   (3020 / 3030), shift both up together (preserving the gap) until a free pair
   is found, then remember it per project in `~/.shaka-perf/ports.json` so it
   stays stable across runs.

### Docker Volumes

Volumes are bind-mounted to host directories (not Docker-managed volumes):

- Files are directly accessible on the host without `sudo`
- Sync changes with `sync-changes` instead of rebuilding images
- Changes persist across container restarts

### Procfile

The Procfile is resolved from the local project directory where you run twin-servers. It uses `run-overmind-command` to run server processes inside Docker containers with proper PID tracking:

```
control-rails: yarn shaka-perf servers run-overmind-command control "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
experiment-rails: yarn shaka-perf servers run-overmind-command experiment "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
```

`experimentDir` and `controlDir` are side checkouts. If `experimentDir` points to another checkout, Docker images build from that checkout and the matching control checkout, while the Procfile, optional `composeFile`, compose project name, image names, and host volume namespace stay tied to the local project directory running the command.

## CLI Reference

### Default (`servers` with no subcommand)

```bash
yarn shaka-perf servers
```

Orchestrates a full session:
1. For each image (experiment and control), detects whether it's stale —
   any non-`.dockerignore`d file in its build context has `mtime` newer than
   the image's `.Created` timestamp — or missing entirely. Experiment is
   checked against `dockerBuildDir`; control against the equivalent path
   inside `controlDir`.
2. If one side is stale, that target is rebuilt. If both are stale, both
   are rebuilt. Containers are stopped first, then restarted on the fresh
   image.
3. If nothing is stale: starts containers only if they're not already
   running.
4. Starts servers via Overmind (blocks until Ctrl+C).

If `controlDir` doesn't exist yet (you haven't cloned the baseline branch),
the mtime check for control is skipped — `build` will prompt you to clone
when it runs.

### Build

```bash
yarn shaka-perf servers build                          # Build both images in parallel
yarn shaka-perf servers build --target experiment      # Build only one
yarn shaka-perf servers build --no-cache               # Build without Docker layer cache
yarn shaka-perf servers prune-cache                    # Prune only this project's build cache
yarn shaka-perf servers prune-cache --images           # Also remove control/experiment images
```

Twin-server builds use an auto-created `docker-container` Buildx builder named
from the project slug. Control and experiment share that cache with each other,
but not with other projects. `prune-cache` clears the isolated builder cache
without touching other Docker build caches or the project's tagged images.
Add `--images` to also remove the configured control and experiment images.
Image removal is not forced; stop containers that still reference the images
before retrying.

### Containers and Servers

```bash
yarn shaka-perf servers start-containers               # Start Docker containers
yarn shaka-perf servers start-servers                  # Start servers via Overmind
yarn shaka-perf servers stop-containers                # Stop and remove volumes
```

### Running Commands in Containers

```bash
yarn shaka-perf servers run-cmd experiment bash
yarn shaka-perf servers run-cmd experiment "bundle exec rails console"
yarn shaka-perf servers run-cmd-parallel "bundle exec rake db:migrate"
```

### Syncing Changes

```bash
yarn shaka-perf servers sync-changes experiment
yarn shaka-perf servers sync-changes control
```

Manual sync, running-menu auto-sync, and `copy-changes-to-ssh` always leave
`audit-results/`, `compare-results/`, and `compare-bisect-results/` on the host
by default. These defaults ship with the `shaka-perf` CLI, so they also apply
when the CLI is installed in another project. Override either list in
`abtests.config.ts`:

```ts
twinServers: {
  // ...
  copyIgnore: {
    folders: [
      'audit-results',
      'compare-results',
      'compare-bisect-results',
      'tmp/traces',
    ],
    files: ['debug.log'],
  },
},
```

Paths use gitignore pattern syntax and are relative to the Git repository root.
Supplying `folders` or `files` replaces that corresponding default list.

### CI / SSH Integration

```bash
# Copy local changes to CI containers via SSH
yarn shaka-perf servers copy-changes-to-ssh <port> <host>
yarn shaka-perf servers copy-changes-to-ssh <port> <host> experiment

# Forward CI ports to localhost
yarn shaka-perf servers forward-ports <port> <host>
```

### Other

```bash
yarn shaka-perf servers get-config <key>               # Print a resolved config value
yarn shaka-perf servers customize-docker-compose       # Copy bundled docker-compose.yml for customization
yarn shaka-perf servers say "Build complete"           # Text-to-speech notification
```

## Options

```
-c, --config <file>    Config file path (default: abtests.config.ts in cwd)
-t, --target <name>    Build target: "control" or "experiment"
    --no-cache         Disable Docker layer cache
-v, --verbose          Verbose output
-h, --help             Show help
    --version          Show version
```
