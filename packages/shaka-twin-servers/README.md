# shaka-twin-servers

Docker-based A/B performance testing infrastructure. Runs two identical servers side-by-side — a **control** (baseline branch) and an **experiment** (your branch) — so you can measure the performance impact of your changes.

## Quick Start (Local)

### Prerequisites

1. Docker and docker-compose installed
2. A sibling directory with the control branch checked out (e.g. `../../my-app-control/`)
3. [Overmind](https://github.com/DarthSim/overmind) installed (for running servers)
4. A `twin-servers.config.ts` in your project directory (see [Configuration](#configuration))

### Setup and Run

```bash
cd your-app

# 1. Build Docker images for both servers
shaka-twin-servers build

# 2. Start containers (they start with `sleep infinity` — servers are started separately)
shaka-twin-servers start-containers

# 3. Start Rails servers via Overmind
shaka-twin-servers start-servers

# 4. Visit the servers
#    Control:    http://localhost:3020
#    Experiment: http://localhost:3030
```

### Iterating on Changes

Docker volumes are bind-mounted to host directories, so you can sync changes without rebuilding images:

```bash
# After making code changes to your experiment branch:
# A. Stop the servers (Ctrl+C on Overmind)
# B. Sync changes to the experiment volume
shaka-twin-servers sync-changes experiment

# C. (If needed) Run setup commands inside the container
shaka-twin-servers run-cmd experiment "bundle exec rake assets:precompile"

# D. Restart the servers
shaka-twin-servers start-servers
```

### Stop Everything

```bash
# Ctrl+C on Overmind to stop servers, then:
docker compose down
```

## Configuration

Create a `twin-servers.config.ts` in your project root:

```ts
import { defineConfig } from 'shaka-twin-servers';

export default defineConfig({
  // Your project directory (where docker-compose.yml lives)
  projectDir: '.',

  // Where the control (baseline) branch is checked out
  controlDir: '../../my-app-control',

  // Docker build context directory (relative to projectDir)
  dockerBuildDir: '..',

  // Dockerfile to use for building images
  dockerfile: 'Dockerfile.production',

  // Build arguments passed to docker build
  dockerBuildArgs: {
    RUBY_VERSION: '3.3.7',
    NODE_VERSION: '24.13.0',
  },

  // docker-compose file (relative to projectDir)
  composeFile: 'docker-compose.yml',

  // Procfile for Overmind (relative to projectDir)
  procfile: 'Procfile',

  // Docker image names
  images: {
    control: 'my-app:control',
    experiment: 'my-app:experiment',
  },

  // Host directories where Docker volumes are bind-mounted
  volumes: {
    control: '~/my_app_control_docker_volume',
    experiment: '~/my_app_experiment_docker_volume',
  },

  // Optional commands to run inside containers after start
  setupCommands: [
    { command: 'bin/rails db:prepare', description: 'Preparing database' },
    { command: 'bin/rails db:seed', description: 'Seeding database' },
  ],
});
```

## Architecture

### Control vs Experiment

- **Control:** Built from the baseline branch (typically `main`). This is your reference point.
- **Experiment:** Built from your current branch. This is what you're measuring.

Both servers run in **production mode** for accurate benchmarking. The only configuration difference is the `PERF_EXPERIMENT` environment variable (`"false"` for control, `"true"` for experiment).

### Ports

| Service           | External (host) | Internal (container) |
|-------------------|-----------------|---------------------|
| Control server    | 3020            | 3000                |
| Experiment server | 3030            | 3000                |

### Docker Volumes

Volumes are bind-mounted to host directories (not Docker-managed volumes). This means:
- Files are directly accessible on the host without `sudo`
- You can sync changes with `shaka-twin-servers sync-changes` instead of rebuilding images
- Changes persist across container restarts

### Procfile

The Procfile uses `shaka-twin-servers run-overmind-command` to run server processes inside the Docker containers with proper PID tracking:

```
control-rails: shaka-twin-servers run-overmind-command control "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
experiment-rails: shaka-twin-servers run-overmind-command experiment "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
```

Logs are displayed side-by-side with `[CONTROL]`/`[EXPERIMENT]` prefixes.

## CLI Commands

### Core Workflow

```bash
shaka-twin-servers build                          # Build both images
shaka-twin-servers build --target experiment      # Build only one
shaka-twin-servers start-containers               # Start Docker containers
shaka-twin-servers start-servers                  # Start servers via Overmind
```

### Running Commands in Containers

```bash
# Interactive shell in a container
shaka-twin-servers run-cmd experiment bash

# Run a specific command
shaka-twin-servers run-cmd experiment "bundle exec rails console"

# Run the same command in both containers in parallel
shaka-twin-servers run-cmd-parallel "bundle exec rake db:migrate"
```

### Syncing Changes

```bash
# Sync local git changes to a volume (uses git diff to copy only changed files)
shaka-twin-servers sync-changes experiment
shaka-twin-servers sync-changes control
```

### CircleCI Integration

For debugging CI runs with SSH:

```bash
# Copy local changes to CI containers via SSH
shaka-twin-servers copy-changes-to-ssh <port> <host>              # both targets
shaka-twin-servers copy-changes-to-ssh <port> <host> experiment   # one target

# Forward CI ports to localhost for browser access
shaka-twin-servers forward-ports <port> <host>                    # default 3020/3030
```

To get the SSH port and host:
1. Go to your CircleCI job
2. Click "Rerun job with SSH"
3. Copy the port and host from the SSH command in the job logs

### Other

```bash
shaka-twin-servers get-config <key>               # Print a resolved config value
shaka-twin-servers say "Build complete"            # Text-to-speech notification (macOS/Linux)
```

## Options

```
-c, --config <file>    Config file path (default: twin-servers.config.ts in cwd)
-v, --verbose          Verbose output
-h, --help             Show help
    --version          Show version
```
