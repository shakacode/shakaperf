# Setting Up Twin Servers for Your Project

This guide walks you through adding `shaka-twin-servers` to a project that already has a production Dockerfile.

## Prerequisites

- Docker
- [Overmind](https://github.com/DarthSim/overmind) (process manager for the Procfile)
- [GNU parallel](https://www.gnu.org/software/parallel/) (`brew install parallel` / `apt install parallel`)

## 1. Create the config file

Create `twin-servers.config.ts` in your project root:

```ts
import { defineConfig } from 'shaka-twin-servers';

export default defineConfig({
  projectDir: '.',

  // Where the control (baseline) branch will be checked out.
  // The build command will prompt you to clone it if it doesn't exist.
  controlDir: '../../my-app-control/my-app',

  // Docker build context directory (parent of projectDir for monorepos)
  dockerBuildDir: '..',

  // Your existing production Dockerfile (relative to projectDir)
  dockerfile: 'Dockerfile.production',

  // Build arguments passed to docker build
  dockerBuildArgs: {
    RUBY_VERSION: '3.3.7',
    NODE_VERSION: '24.13.0',
  },

  composeFile: 'docker-compose.yml',
  procfile: 'Procfile',

  images: {
    control: 'my-app:control',
    experiment: 'my-app:experiment',
  },

  // Host directories where Docker volumes are bind-mounted.
  // Files are directly accessible on the host — no `docker cp` needed.
  volumes: {
    control: '~/my_app_control_docker_volume',
    experiment: '~/my_app_experiment_docker_volume',
  },

  // Commands to run inside containers after start (e.g. database setup)
  setupCommands: [
    { command: 'bin/rails db:prepare', description: 'Preparing database' },
  ],
});
```

## 2. Prepare your Dockerfile

Your production Dockerfile needs one change for twin-servers — remove CMD/ENTRYPOINT. Twin-servers manages the server lifecycle through docker-compose (`command: sleep infinity`) and Overmind, so the containers stay alive while servers can be started/stopped independently.

```dockerfile
EXPOSE 3000

# For twin-servers: CMD and ENTRYPOINT are removed.
# docker-compose uses 'command: sleep infinity' instead,
# so servers can be started/stopped without restarting containers.
```

## 3. Create docker-compose.yml

```yaml
x-server-env: &server-env
  RAILS_ENV: production
  SECRET_KEY_BASE: my-app-not-a-real-secret-just-for-perf-testing
  RAILS_LOG_TO_STDOUT: "true"
  RAILS_SERVE_STATIC_FILES: "true"

services:
  control-server:
    image: ${CONTROL_IMAGE_NAME}
    ports:
      - "3020:3000"
    environment:
      <<: *server-env
      PERF_EXPERIMENT: "false"
    volumes:
      - my_app_control:/home/${USER}/app
    command: sleep infinity

  experiment-server:
    image: ${EXPERIMENT_IMAGE_NAME}
    ports:
      - "3030:3000"
    environment:
      <<: *server-env
      PERF_EXPERIMENT: "true"
    volumes:
      - my_app_experiment:/home/${USER}/app
    command: sleep infinity

volumes:
  my_app_control:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ~/my_app_control_docker_volume
  my_app_experiment:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: ~/my_app_experiment_docker_volume
```

Key points:
- `EXPERIMENT_IMAGE_NAME` and `CONTROL_IMAGE_NAME` are set automatically by shaka-twin-servers
- `command: sleep infinity` keeps containers alive — Overmind manages server processes
- `PERF_EXPERIMENT` distinguishes control from experiment at runtime
- Bind-mount volumes let you sync code changes without rebuilding images

## 4. Create a Procfile

```
control-rails: yarn shaka-twin-servers run-overmind-command control "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
experiment-rails: yarn shaka-twin-servers run-overmind-command experiment "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
notify-control-server-started: dockerize -wait http://localhost:3020 -timeout 60s && yarn shaka-twin-servers say "Control server started" && while :; do sleep 2073600; done
notify-experiment-server-started: dockerize -wait http://localhost:3030 -timeout 60s && yarn shaka-twin-servers say "Experiment server started" && while :; do sleep 2073600; done
```

`run-overmind-command` runs the command inside the Docker container with proper PID tracking so Overmind can stop/restart individual processes.

