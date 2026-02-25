# shaka-twin-servers

Docker-based A/B performance testing infrastructure. Runs two identical servers side-by-side — a **control** (baseline branch) and an **experiment** (your branch) — so you can measure the performance impact of your changes.

> **First time?** See [SETUP.md](./SETUP.md) for step-by-step instructions on adding twin-servers to your project.

## Usage

```bash
cd your-app

# Build Docker images for both servers
yarn shaka-twin-servers build

# Start containers
yarn shaka-twin-servers start-containers

# Start servers via Overmind
yarn shaka-twin-servers start-servers

# Visit:
#   Control:    http://localhost:3020
#   Experiment: http://localhost:3030
```

### Iterating on Changes

Docker volumes are bind-mounted to host directories, so you can sync changes without rebuilding images:

```bash
# Stop servers (Ctrl+C on Overmind), then:
yarn shaka-twin-servers sync-changes experiment

# Rebuild JS in experiment container. E.G., for RORP, run:
yarn shaka-twin-servers run-cmd experiment "bundle exec rake assets:precompile"

# Restart servers
yarn shaka-twin-servers start-servers
```

### Stop Everything

```bash
# Ctrl+C on Overmind to stop servers, then:
docker compose down
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

### Docker Volumes

Volumes are bind-mounted to host directories (not Docker-managed volumes):
- Files are directly accessible on the host without `sudo`
- Sync changes with `sync-changes` instead of rebuilding images
- Changes persist across container restarts

### Procfile

The Procfile uses `run-overmind-command` to run server processes inside Docker containers with proper PID tracking:

```
control-rails: yarn shaka-twin-servers run-overmind-command control "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
experiment-rails: yarn shaka-twin-servers run-overmind-command experiment "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
```

## CLI Reference

### Build

```bash
yarn shaka-twin-servers build                          # Build both images in parallel
yarn shaka-twin-servers build --target experiment      # Build only one
yarn shaka-twin-servers build --no-cache               # Build without Docker layer cache
```

### Containers and Servers

```bash
yarn shaka-twin-servers start-containers               # Start Docker containers
yarn shaka-twin-servers start-servers                  # Start servers via Overmind
```

### Running Commands in Containers

```bash
yarn shaka-twin-servers run-cmd experiment bash
yarn shaka-twin-servers run-cmd experiment "bundle exec rails console"
yarn shaka-twin-servers run-cmd-parallel "bundle exec rake db:migrate"
```

### Syncing Changes

```bash
yarn shaka-twin-servers sync-changes experiment
yarn shaka-twin-servers sync-changes control
```

### CI / SSH Integration

```bash
# Copy local changes to CI containers via SSH
yarn shaka-twin-servers copy-changes-to-ssh <port> <host>
yarn shaka-twin-servers copy-changes-to-ssh <port> <host> experiment

# Forward CI ports to localhost
yarn shaka-twin-servers forward-ports <port> <host>
```

### Other

```bash
yarn shaka-twin-servers get-config <key>               # Print a resolved config value
yarn shaka-twin-servers say "Build complete"            # Text-to-speech notification
```

## Options

```
-c, --config <file>    Config file path (default: twin-servers.config.ts in cwd)
-t, --target <name>    Build target: "control" or "experiment"
    --no-cache         Disable Docker layer cache
-v, --verbose          Verbose output
-h, --help             Show help
    --version          Show version
```
