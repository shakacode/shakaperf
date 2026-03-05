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
  dockerfile: 'twin-servers/Dockerfile',

  // Build arguments passed to docker build
  dockerBuildArgs: {
    RUBY_VERSION: '3.3.7',
    NODE_VERSION: '24.13.0',
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

## 3. Custom Docker Compose (optional)

A default [`docker-compose.yml`](./templates/docker-compose.yml) is bundled with the package. Most projects don't need a custom one. To get a custom copy you can edit, run:
```bash
yarn shaka-twin-servers customize-docker-compose
```

Key points about the default:
- `EXPERIMENT_IMAGE_NAME`, `CONTROL_IMAGE_NAME`, `CONTROL_VOLUME_DIR`, and `EXPERIMENT_VOLUME_DIR` are set automatically by shaka-twin-servers
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
control-rails: yarn shaka-twin-servers run-overmind-command control "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
experiment-rails: yarn shaka-twin-servers run-overmind-command experiment "bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000"
notify-control-server-started: dockerize -wait http://localhost:3020 -timeout 60s && yarn shaka-twin-servers say "Control server started" && while :; do sleep 2073600; done
notify-experiment-server-started: dockerize -wait http://localhost:3030 -timeout 60s && yarn shaka-twin-servers say "Experiment server started" && while :; do sleep 2073600; done
```

`run-overmind-command` runs the command inside the Docker container with proper PID tracking so Overmind can stop/restart individual processes.

## 5. File organization

Put all Docker/twin-servers files in a `twin-servers/` subdirectory. Keep `Dockerfile`, `docker-compose.yml`, and `Procfile` in `twin-servers/` — not in the project root. This keeps the project clean and makes it clear these files are for twin-servers only. Reference them in the config:
```ts
dockerfile: 'twin-servers/Dockerfile',
composeFile: 'twin-servers/docker-compose.yml',
procfile: 'twin-servers/Procfile',
```

---

## AI notes

These notes are for AI assistants helping with twin-servers setup. They capture common pitfalls encountered during real setups.

### Dockerfile pitfalls

1. **Override `NODE_ENV` during `yarn install`.** The Dockerfile should set `NODE_ENV=production` (these are production perf tests), but that makes `yarn install` skip devDependencies. DevDeps like `vite` and `tsx` are needed for building assets. Override it inline:
   ```dockerfile
   RUN NODE_ENV=development yarn install --frozen-lockfile
   ```

2. **Put all paths under the non-root user's home.** Use `/home/${NON_ROOT_USER}/app`, `/home/${NON_ROOT_USER}/bundle`, `/home/${NON_ROOT_USER}/node` — NOT `/app`, `/usr/local/bundle`, etc. Twin-servers uses bind-mount volumes, so the container user's UID/GID must match the host user. Placing everything under the user's home directory avoids permission conflicts.

3. **Use `COPY --chown` for all file copies in the build stage.** This ensures the non-root user owns everything without needing extra `chown` commands.

4. **Keep writable directories.** Ensure `log`, `tmp/pids`, `tmp/cache`, and `storage` directories exist with correct ownership in the production stage:
   ```dockerfile
   RUN mkdir -p log tmp/pids tmp/cache storage && \
       chown -R ${NON_ROOT_USER}:${NON_ROOT_USER} log tmp storage
   ```

5. **Don't change the project's `.node-version` or any other project files.** Dockerization should not require changes to the project itself beyond the `twin-servers/` directory. The Docker container can use the project's Node version via `dockerBuildArgs.NODE_VERSION` — don't modify `.node-version`, `engines.node`, or `package.json` in the project.

1. **Disable `force_ssl`.** Rails forces SSL in production, but twin-servers runs locally over HTTP:
   ```ruby
   config.force_ssl = ENV['TWIN_SERVERS'] != 'true'
   ```

2. **Guard side effects during seeding.** Seeding in production mode triggers things like sending real emails via external APIs (e.g. CampaignMonitor). Guard these:
   ```ruby
   return if Rails.env.test? || Rails.env.development? || ENV['TWIN_SERVERS'] == 'true'
   ```

3. **Include all infrastructure setup commands.** Don't forget to include database seeding, search index creation, and any other setup the app needs. Try to reuse existing setup scripts from dev instructions where possible. For a Rails app with Elasticsearch:
   ```ts
   setupCommands: [
     // ... start infrastructure services first ...
     { command: 'bin/setup-db', description: 'Running database setup' },
     { command: 'bin/rails db:seed', description: 'Seeding database' },
     { command: 'bin/rails elasticsearch:create_indexes', description: 'Creating Elasticsearch indexes' },
     { command: 'bin/rails elasticsearch:import_all', description: 'Importing Elasticsearch data' },
   ],
   ```

4. **Move environment variables into the Dockerfile, not docker-compose.** Env vars like `SECRET_KEY_BASE`, `MEMCACHEDCLOUD_SERVERS`, `TWIN_SERVERS`, API keys (set to skip/placeholder values), and database config should be `ENV` directives in the Dockerfile. This keeps docker-compose minimal and ensures the values are baked into the image. Only use docker-compose `environment:` for values that differ between control and experiment (like `PERF_EXPERIMENT` and `ELASTICSEARCH_URL`).


5. **Make `database.yml` username configurable.** The container runs as a non-root user (e.g. `rails`), but the production database config may hardcode a different username:
   ```yaml
   username: <%= ENV.fetch('DB_USERNAME', 'original_username') %>
   ```
   Then set `ENV DB_USERNAME=${NON_ROOT_USER}` in the Dockerfile.
