# Twin Servers A/B Testing Guide

This guide explains how to use the twin-servers setup for A/B performance testing with the demo-ecommerce app.

## Prerequisites

1. **GNU Parallel** (for parallel builds):
   ```bash
   # macOS
   brew install parallel

   # Linux
   sudo apt-get install parallel
   ```

2. **Control Repository** (baseline branch):
   ```bash
   cd ..
   git clone <repo-url> shaka-perf-control
   cd shaka-perf-control
   git checkout main  # or your baseline branch
   ```

3. **Rails Master Key**:
   ```bash
   # Make sure you have demo-ecommerce/config/master.key
   # If not, get it from your team or generate a new one
   ```

## Quick Start

### 1. Build Docker Images

```bash
# From the monorepo root
./demo-ecommerce/bin/build-twin-servers
```

This builds two Docker images in parallel:
- `demo-ecommerce:control` - from `../shaka-perf-control` (baseline)
- `demo-ecommerce:experiment` - from current branch (your changes)

### 2. Start Containers

```bash
cd demo-ecommerce
export RAILS_MASTER_KEY=$(cat config/master.key)
./bin/start-containers
```

This will:
- Create bind-mount directories (`~/demo_ecommerce_*_docker_volume`)
- Start Docker Compose services
- Set up SQLite databases
- Run seeds if present

### 3. Start Rails Servers

```bash
./bin/start-servers
```

This starts Rails servers inside both containers:
- Control: http://localhost:3020
- Experiment: http://localhost:3030

### 4. Run Performance Tests

```bash
# Run your performance testing tools
# Example with k6, lighthouse, etc.
k6 run tests/performance/scenario.js
```

### 5. Stop Everything

```bash
./bin/stop
```

## Alternative: Use docker-compose directly

If you don't need parallel builds:

```bash
cd demo-ecommerce
export RAILS_MASTER_KEY=$(cat config/master.key)
docker compose up --build
```

Then start servers:
```bash
./bin/start-servers
```

## Workflow Scripts

| Script | Description |
|--------|-------------|
| `bin/build-twin-servers` | Build both Docker images in parallel |
| `bin/start-containers` | Start containers and set up databases |
| `bin/start-servers` | Start Rails servers inside containers |
| `bin/stop` | Stop Rails servers and containers |

## Debugging

### Access container shell:
```bash
docker compose exec control-server bash
docker compose exec experiment-server bash
```

### View logs:
```bash
docker compose logs -f control-server
docker compose logs -f experiment-server
```

### Edit files in containers:
The app code is mounted at:
- Control: `~/demo_ecommerce_control_docker_volume`
- Experiment: `~/demo_ecommerce_experiment_docker_volume`

You can edit files there and restart servers without rebuilding.

### Restart a single server:
```bash
docker compose exec control-server bash
# Inside container:
pkill -f 'rails server'
rm -f tmp/pids/server.pid
bin/rails server -b 0.0.0.0
```

## Architecture

```
┌─────────────────────────────────────────┐
│  Control Server (Port 3020)             │
│  - Image: demo-ecommerce:control        │
│  - Source: ../shaka-perf-control        │
│  - Volume: ~/demo_ecommerce_control_*   │
│  - DB: SQLite (control_production)      │
│  - PERF_EXPERIMENT=false                │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Experiment Server (Port 3030)          │
│  - Image: demo-ecommerce:experiment     │
│  - Source: current branch               │
│  - Volume: ~/demo_ecommerce_experiment_*│
│  - DB: SQLite (experiment_production)   │
│  - PERF_EXPERIMENT=true                 │
└─────────────────────────────────────────┘
```

## Environment Variables

The app can detect which server it's running on:

```ruby
# In your Rails code
if ENV['PERF_EXPERIMENT'] == 'true'
  # Experiment-specific code
else
  # Control code
end
```

## Troubleshooting

### "Image not found" error
Run `./bin/build-twin-servers` first to build images.

### "Control directory not found"
Clone the control repository:
```bash
cd ..
git clone <repo-url> shaka-perf-control
cd shaka-perf-control
git checkout main
```

### "RAILS_MASTER_KEY not set"
Export the key:
```bash
export RAILS_MASTER_KEY=$(cat demo-ecommerce/config/master.key)
```

### Database issues
Reset databases:
```bash
docker compose exec control-server bin/rails db:reset
docker compose exec experiment-server bin/rails db:reset
```

### Port already in use
Stop any processes using ports 3020 or 3030:
```bash
lsof -ti:3020 | xargs kill -9
lsof -ti:3030 | xargs kill -9
```

## Performance Testing Tips

1. **Warm up both servers** before measuring
2. **Run tests multiple times** to account for variance
3. **Monitor resource usage** with `docker stats`
4. **Use identical data** in both databases
5. **Test with realistic traffic patterns**

## Related Documentation

- [Docker Setup Guide](packages/shaka-twin-servers/docs/docker-setup-guide.md) - Full twin-servers patterns
- [docker-compose.yml](docker-compose.yml) - Service configuration
- [Dockerfile.production](Dockerfile.production) - Image build configuration
