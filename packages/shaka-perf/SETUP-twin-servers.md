# Setting Up Twin Servers for Your Project

This guide walks you through adding twin-servers to a project that already has a production Dockerfile.

## Prerequisites

- Docker
- [Overmind](https://github.com/DarthSim/overmind) (process manager for the Procfile)
- [GNU parallel](https://www.gnu.org/software/parallel/) (`brew install parallel` / `apt install parallel`)

## 0. Take a look at the demo
- [`demo-ecommerce/twin-servers.config.ts`](../../demo-ecommerce/twin-servers.config.ts)
- [`demo-ecommerce/twin-servers/Dockerfile`](../../demo-ecommerce/twin-servers/Dockerfile)
- [`demo-ecommerce/twin-servers/Dockerfile.dockerignore`](../../demo-ecommerce/twin-servers/Dockerfile.dockerignore)
- [`demo-ecommerce/twin-servers/Procfile`](../../demo-ecommerce/twin-servers/Procfile)


## 1. Create the config file

Create `twin-servers.config.ts` in your project root:

```ts
import { defineConfig } from 'shaka-perf/twin-servers';

export default defineConfig({
  projectDir: '.',

  // Where the control (baseline) branch will be checked out.
  // The build command will prompt you to clone it if it doesn't exist.
  controlDir: '../../my-app-control/my-app',

  // Docker build context directory (parent of projectDir for monorepos)
  dockerBuildDir: '..',

  // Your existing production Dockerfile (relative to projectDir)
  dockerfile: 'twin-servers/Dockerfile',

  // Build arguments passed to docker build
  dockerBuildArgs: {
    // Optional
  },

  procfile: 'twin-servers/Procfile',

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

Twin-servers need to run in production mode locally, so if you don't have a production local build, you will need one. It should be as close as possible to the actual production, except for prod-only APIs and the DB. You may need to add `ENV TWIN_SERVERS=true` env var to your `twin-servers/Dockerfile` to disable things that break locally.

Then extend your dev-only checks to also check the variable, e.g:
`return if Rails.env.test? || Rails.env.development? || ENV['TWIN_SERVERS'] == 'true'`

Your production Dockerfile needs one change for twin-servers — remove CMD/ENTRYPOINT. Twin-servers manages the server lifecycle through docker-compose (`command: sleep infinity`) and Overmind, so the containers stay alive while servers can be started/stopped independently.

```dockerfile
EXPOSE 3000

# For twin-servers: CMD and ENTRYPOINT are removed.
# docker-compose uses 'command: sleep infinity' instead,
# so servers can be started/stopped without restarting containers.
```

### Dockerfile tips

**Create a non-root user with matching UID/GID.** Twin-servers uses bind-mount volumes, so the container user must match the host user. Define build args and create the user early in your Dockerfile:
```dockerfile
ARG NON_ROOT_USER=rails
ARG UID=1000
ARG GID=1000

FROM ruby:${RUBY_VERSION}-bullseye AS base

# Re-declare ARGs after FROM (they don't persist across stages)
ARG NON_ROOT_USER
ARG UID
ARG GID
```

Then create the user and workspace:
```dockerfile
# Mac/Linux GID compatibility: delete any existing group with the same GID
RUN getent group $GID | cut -d: -f1 | xargs -r groupdel || true

# Create non-root user and workspace with matching UID/GID from host
RUN groupadd --gid $GID ${NON_ROOT_USER} && \
    useradd ${NON_ROOT_USER} --uid $UID --gid $GID --create-home --shell /bin/bash
RUN mkdir -p $APP_PATH && chown -R ${NON_ROOT_USER}:${NON_ROOT_USER} /home/${NON_ROOT_USER}
RUN chown ${NON_ROOT_USER}:${NON_ROOT_USER} /var/run/postgresql
WORKDIR $APP_PATH
```

**Put all paths under the non-root user's home.** Use `/home/${NON_ROOT_USER}/app`, `/home/${NON_ROOT_USER}/bundle`, `/home/${NON_ROOT_USER}/node` — NOT `/app`, `/usr/local/bundle`, etc. Twin-servers uses bind-mount volumes, so the container user's UID/GID must match the host user. Placing everything under the user's home directory avoids permission conflicts.

**Use `COPY --chown` for all file copies in the build stage.** This ensures the non-root user owns everything without needing extra `chown` commands.

**Keep writable directories.** Ensure `log`, `tmp/pids`, `tmp/cache`, and `storage` directories exist with correct ownership in the production stage:
```dockerfile
RUN mkdir -p log tmp/pids tmp/cache storage && \
    chown -R ${NON_ROOT_USER}:${NON_ROOT_USER} log tmp storage
```

**Don't change the project's `.node-version` or any other project files.** Dockerization should not require changes to the project itself beyond the `twin-servers/` directory. The Docker container can use the project's Node version via `dockerBuildArgs.NODE_VERSION` — don't modify `.node-version`, `engines.node`, or `package.json` in the project.

**Move environment variables into the Dockerfile, not docker-compose.** Env vars like `SECRET_KEY_BASE`, `MEMCACHEDCLOUD_SERVERS`, `TWIN_SERVERS`, API keys (set to skip/placeholder values), and database config should be `ENV` directives in the Dockerfile. This keeps docker-compose minimal and ensures the values are baked into the image. Only use docker-compose `environment:` for values that differ between control and experiment (like `PERF_EXPERIMENT` and `ELASTICSEARCH_URL`).

**Make `database.yml` username configurable.** The container runs as a non-root user, but the production database config may hardcode a different username:
```yaml
username: <%= ENV.fetch('DB_USERNAME', 'original_username') %>
```
Then set `ENV DB_USERNAME=${NON_ROOT_USER}` in the Dockerfile.

### App tips

**Disable `force_ssl`.** Rails forces SSL in production, but twin-servers runs locally over HTTP:
```ruby
config.force_ssl = ENV['TWIN_SERVERS'] != 'true'
```

**Guard side effects during seeding.** Seeding in production mode triggers things like sending real emails via external APIs (e.g. CampaignMonitor). Guard these:
```ruby
return if Rails.env.test? || Rails.env.development? || ENV['TWIN_SERVERS'] == 'true'
```

**Include all infrastructure setup commands.** Users might want to do something interesting with the database or similar stuff, so perform DB seeding at Container start, so the devs can see how they can extend it. E.G.:
```ts
setupCommands: [
  // ... start infrastructure services first ...
  { command: 'bin/setup-db', description: 'Running database setup' },
  { command: 'bin/rails db:seed', description: 'Seeding database' },
],
```

** Keep it DRY ** Try to reuse existing setup scripts from dev instructions where possible.

## 3. Custom Docker Compose (optional)

A default [`docker-compose.yml`](./templates/docker-compose.yml) is bundled with the package. Most projects don't need a custom one. To get a custom copy you can edit, run:
```bash
yarn shaka-perf twins-customize-docker-compose
```

Key points about the default:
- `EXPERIMENT_IMAGE_NAME`, `CONTROL_IMAGE_NAME`, `CONTROL_VOLUME_DIR`, and `EXPERIMENT_VOLUME_DIR` are set automatically by shaka-perf twin-servers
- `command: sleep infinity` keeps containers alive — Overmind manages server processes
- `PERF_EXPERIMENT` distinguishes control from experiment at runtime
- Bind-mount volumes let you sync code changes without rebuilding images

If your setup needs to depend on other dockerized services, you can create a custom compose file. But keep it minimal.

**Keep your docker-compose.yml simple!** If anything can be moved to the Dockerfile, do it. Reasons:
* **Isolation.** The two instances of the app run side by side in parallel, so we don't want to share any resources between them.
* **Separation of concerns.** Docker-compose manages twin-server-related concerns (ports, debugging volumes). All setup concerns (build steps, database setup, environment variables, etc.) belong in the Dockerfile.

Keep in mind that any differences in setup may result in false performance regressions that are very hard to pinpoint.

**For every single service your app depends on, create a pair of -control and -experiment services in the docker-compose.yml.** Experiment server should not depend on the same services as the control server!

**Don't use separate worker containers.** Run sidekiq/workers inside the main server container, not in separate Docker services. These are perf-tests, not a production setup. A/B diligence and simplicity is more important than
system reliability and efficient scaling.

**Embed Postgres, Redis, Memcached, and other services inside the app container** rather than running them as separate Docker Compose services. This simplifies the setup and avoids networking issues. Install them in the Dockerfile and start them via `setupCommands`:
```ts
setupCommands: [
  { command: 'initdb -D ~/pgdata && pg_ctl -D ~/pgdata -l ~/pgdata/logfile start', description: 'Starting PostgreSQL' },
  { command: 'redis-server --save "" --appendonly no --daemonize yes', description: 'Starting Redis' },
  { command: 'memcached -d', description: 'Starting Memcached' },
  // ... then run db setup, seeding, etc.
],
```

If a service already has a Dockerized setup in the project's dev instructions (e.g. separate docker container for  Elasticsearch), reuse it as a pair of -control and -experiment separate Docker Compose services. However, extending docker-compose is not recommended; do it only if it will simplify things and reduce the diff.

## 4. Create a Procfile

```
control-rails: yarn shaka-perf twins-run-overmind-command control "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
experiment-rails: yarn shaka-perf twins-run-overmind-command experiment "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
notify-control-server-started: dockerize -wait http://localhost:3020 -timeout 60s && yarn shaka-perf twins-say "Control server started" && while :; do sleep 2073600; done
notify-experiment-server-started: dockerize -wait http://localhost:3030 -timeout 60s && yarn shaka-perf twins-say "Experiment server started" && while :; do sleep 2073600; done
```

`run-overmind-command` runs the command inside the Docker container with proper PID tracking so Overmind can stop/restart individual processes.

## 5. File organization

Put all Docker/twin-servers files in a `twin-servers/` subdirectory. Keep `Dockerfile`, `docker-compose.yml`, and `Procfile` in `twin-servers/` — not in the project root. This keeps the project clean and makes it clear these files are for twin-servers only. Reference them in the config:
```ts
dockerfile: 'twin-servers/Dockerfile',
composeFile: 'twin-servers/docker-compose.yml',
procfile: 'twin-servers/Procfile',
```

