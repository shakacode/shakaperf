# Docker Setup Guide for Twin-Servers A/B Testing

This guide documents the unique patterns required in your Dockerfile and docker-compose.yml to support shaka-twin-servers A/B performance testing.

## Table of Contents

- [Overview](#overview)
- [Dockerfile Requirements](#dockerfile-requirements)
- [docker-compose.yml Requirements](#docker-composeyml-requirements)
- [Build Script Patterns](#build-script-patterns)
- [CircleCI Configuration](#circleci-configuration)
- [Quick Checklist](#quick-checklist)

## Overview

Twin-servers runs two versions of your application side-by-side:

- **Control server** (port 3020): Built from master branch (baseline)
- **Experiment server** (port 3030): Built from your current branch (changes being tested)

This setup requires specific Docker patterns to enable:

1. Editing files in mounted volumes without sudo
2. Restarting servers without restarting containers
3. Running both servers with isolated databases

## Dockerfile Requirements

### 1. Configurable UID/GID ARGs

```dockerfile
ARG UID=1000
ARG GID=1000
ARG NON_ROOT_USER=my_user
```

**What this does:**

- `ARG` declares a build-time variable that can be overridden with `--build-arg`
- `UID=1000` sets a default value of 1000 (common Linux default user ID)
- `GID=1000` sets a default value of 1000 (common Linux default group ID)
- `NON_ROOT_USER=my_user` sets a default username for the container user

These values are used later to create a user inside the container that matches your host machine's user.

**Why this matters:**

Every file in Linux/Docker has an owner identified by a UID (User ID) and GID (Group ID). When Docker creates files inside a container, they're owned by the container's user (e.g., UID 1000). If your host machine user has a different UID (e.g., macOS defaults to 501), you'll need `sudo` to edit those files.

By making UID/GID configurable, you can build the image to match your host user:

```bash
docker build --build-arg UID=$(id -u) --build-arg GID=$(id -g) ...
```

- `$(id -u)` returns your current user's UID (e.g., `501` on macOS)
- `$(id -g)` returns your current user's GID (e.g., `20` on macOS)

### 2. Mac/Linux GID Compatibility Hack

```dockerfile
# Delete any existing group with the same GID (e.g., Mac's GID 20 = dialout on Debian)
RUN getent group $GID | cut -d: -f1 | xargs -r groupdel
```

**What this does (step by step):**

```bash
getent group $GID     →  Look up the group with this GID in /etc/group
                          Example output: "dialout:x:20:"
        |
        v
cut -d: -f1           →  Extract the first field (group name) using ":" as delimiter
                          Example output: "dialout"
        |
        v
xargs -r groupdel     →  Delete that group (if it exists)
                          -r means "don't run if input is empty"
```

So if your Mac user has GID 20, this command finds that GID 20 is already used by "dialout" group in the Debian container, then deletes the "dialout" group so you can create your own group with GID 20.

**Why this matters:**

macOS uses GID 20 for the "staff" group (the default for most users). But Debian/Ubuntu Linux already has GID 20 assigned to the "dialout" group. When you try to create a group with GID 20, it fails because that GID is taken.

This line removes any existing group with the target GID before creating the new one.

### 3. Non-root User Creation

```dockerfile
RUN groupadd --gid $GID ${NON_ROOT_USER} && \
    useradd --uid $UID \
    --gid ${NON_ROOT_USER} \
    --shell /bin/sh \
    --create-home ${NON_ROOT_USER}

RUN mkdir -p $APP_PATH && chown -R ${NON_ROOT_USER}:${NON_ROOT_USER} /home/${NON_ROOT_USER}
WORKDIR $APP_PATH

USER ${NON_ROOT_USER}
```

**What this does:**

| Command | What it does |
|---------|--------------|
| `groupadd --gid $GID ${NON_ROOT_USER}` | Creates a new group with the specified GID and name |
| `useradd --uid $UID` | Creates a new user with the specified UID |
| `--gid ${NON_ROOT_USER}` | Assigns the user to the group we just created |
| `--shell /bin/sh` | Sets the user's default shell |
| `--create-home` | Creates a home directory at `/home/${NON_ROOT_USER}` |
| `mkdir -p $APP_PATH` | Creates the application directory (e.g., `/home/my_user/app`) |
| `chown -R ...` | Recursively changes ownership of the home directory to the new user |
| `WORKDIR $APP_PATH` | Sets the default directory for subsequent commands |
| `USER ${NON_ROOT_USER}` | Switches from root to the new user for all subsequent commands |

**Why this matters:**

1. **Security**: Running as root inside a container is a security risk
2. **Volume permissions**: Files created by this user will match your host UID/GID

### 4. COPY --chown Pattern

```dockerfile
COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} Gemfile Gemfile.lock ./
COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} . .
```

**What this does:**

- `COPY` copies files from your host machine into the Docker image
- `--chown=user:group` sets the owner of the copied files
- Without `--chown`: files are owned by `root:root` (UID 0, GID 0)
- With `--chown`: files are owned by your specified user

**Why this matters:**

Without `--chown`, copied files are owned by root. With `--chown`, they're owned by your non-root user, ensuring consistent permissions. This prevents "permission denied" errors when your app tries to modify its own files.

### 5. No CMD or ENTRYPOINT

**Do NOT add** a default CMD or ENTRYPOINT to your Dockerfile.

**Why this matters:**

We use `command: sleep infinity` in docker-compose to keep containers alive without running the server. This lets you:

- Start/stop/restart the server process without restarting the container
- Preserve installed dependencies and environment state
- Run arbitrary commands inside the container

### 6. Dummy Credentials for Asset Precompilation

```dockerfile
# Set dummy AWS credentials for asset precompilation
ENV MGXCOPY_AWS_S3_ACCESS_KEY_ID=a123 \
    MGXCOPY_AWS_S3_SECRET_ACCESS_KEY=a123 \
    SECRET_KEY_BASE=NOT_USED_NON_BLANK

RUN bundle exec rails assets:precompile
```

**What this does:**

- `ENV` sets environment variables that persist in the image
- These dummy values (`a123`, `NOT_USED_NON_BLANK`) are placeholders
- `bundle exec rails assets:precompile` compiles JavaScript, CSS, and other assets into static files

The asset precompilation step runs during the Docker build, not at runtime. It converts your source files (SCSS, TypeScript, etc.) into optimized, minified production assets.

**Why this matters:**

Rails asset precompilation in production mode often requires environment variables (API keys, secret keys, etc.) to be present, even if they're not actually used during compilation. Dummy values satisfy these checks without exposing real credentials in your Docker image. The real credentials are provided at runtime via docker-compose.

## docker-compose.yml Requirements

### 1. Bind-Mounted Volumes (NOT Named Volumes)

```yaml
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

**What this does:**

| Line | What it does |
|------|--------------|
| `driver: local` | Use the local filesystem driver (not a remote/cloud driver) |
| `type: none` | Don't use any special filesystem type (no NFS, CIFS, etc.) |
| `o: bind` | Use a bind mount (directly link to a host directory) |
| `device: ~/my_app_control_docker_volume` | The host directory to mount |

When a container writes to `/home/my_user/app`, those files actually appear in `~/my_app_control_docker_volume` on your host machine.

**Comparison:**

| Volume Type | Host Visibility | Editable? | Use Case |
|-------------|-----------------|-----------|----------|
| Named (`data:`) | Hidden in Docker's storage | Need Docker CLI | Production, databases |
| Bind-mounted | Visible in `~/` | Yes, directly | Development, A/B testing |

Bind mounts let you:

- See and edit container files from your host machine
- Copy local changes into the container without rebuilding
- Use your normal editor/IDE on mounted files

### 2. Twin Server Services

```yaml
services:
  control-server:
    image: ${CI_CONTROL_IMAGE_NAME}
    ports:
      - "3020:3000"
    environment:
      PERF_EXPERIMENT: "false"
      DATABASE_URL: "mysql2://root@mysql-control:3306/my_app_development"
    volumes:
      - my_app_control:/home/${USER}/app
    command: sleep infinity

  experiment-server:
    image: ${CI_IMAGE_NAME}
    ports:
      - "3030:3000"
    environment:
      PERF_EXPERIMENT: "true"
      DATABASE_URL: "mysql2://root@mysql-experiment:3306/my_app_development"
    volumes:
      - my_app_experiment:/home/${USER}/app
    command: sleep infinity
```

**What this does:**

| Line | What it does |
|------|--------------|
| `image: ${CI_CONTROL_IMAGE_NAME}` | Uses a Docker image from an environment variable (set at runtime) |
| `ports: "3020:3000"` | Maps host port 3020 to container port 3000 (format: `host:container`) |
| `PERF_EXPERIMENT: "false"` | Environment variable your app can read to know which server it is |
| `DATABASE_URL: "mysql2://..."` | Connection string pointing to this server's dedicated database |
| `volumes: - my_app_control:/home/...` | Mounts the bind volume inside the container at the app path |
| `command: sleep infinity` | Overrides the image's default command to just sleep forever |

**Key patterns:**

- Different ports (3020 vs 3030) to access each server
- `PERF_EXPERIMENT` flag to distinguish control vs experiment in your app code
- Separate DATABASE_URL pointing to isolated databases
- Same internal port (3000) mapped to different external ports

### 3. The `sleep infinity` Pattern

```yaml
command: sleep infinity
```

**What this does:**

- `command:` overrides the default CMD/ENTRYPOINT from the Dockerfile
- `sleep infinity` is a Unix command that sleeps forever (never exits)
- The container starts, does nothing, and stays running indefinitely
- You then manually start processes inside the container using `docker exec`

```bash
# Start a shell inside the container
docker exec -it control-server bash

# Or run a specific command
docker exec -it control-server bundle exec rails server
```

**Why this matters:**

Instead of starting the server automatically, the container just sleeps. You then start the server manually.

Benefits:

- **Restart without rebuild**: Kill the server process and restart it—container state (gems, env vars, node_modules) is preserved
- **Debugging**: Shell into the container, inspect state, run commands
- **Flexibility**: Start different processes (console, rake tasks) as needed

### 4. Separate Databases

```yaml
services:
  mysql-control: &mysql
    image: mysql:8.0
    environment:
      MYSQL_ALLOW_EMPTY_PASSWORD: "yes"
      MYSQL_DATABASE: my_app_development
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 5s
      timeout: 5s
      retries: 10

  mysql-experiment:
    <<: *mysql  # YAML anchor - copies all settings from mysql-control
```

**What this does:**

| Line | What it does |
|------|--------------|
| `&mysql` | Creates a YAML anchor named "mysql" (like a variable) |
| `image: mysql:8.0` | Uses the official MySQL 8.0 Docker image |
| `MYSQL_ALLOW_EMPTY_PASSWORD` | Lets MySQL run without requiring a root password |
| `MYSQL_DATABASE` | Automatically creates this database on first startup |
| `healthcheck: test: [...]` | Runs `mysqladmin ping` to check if MySQL is ready |
| `interval: 5s` | Checks every 5 seconds |
| `retries: 10` | Tries 10 times before marking as unhealthy |
| `<<: *mysql` | Copies all settings from the `&mysql` anchor (creates an identical service) |

**Why this matters:**

Each server needs its own database to ensure complete isolation. A change in experiment shouldn't affect control's data.

Shared services like Redis are OK since they're typically stateless caches.

### 5. Health Checks and Dependencies

```yaml
control-server:
  depends_on:
    mysql-control:
      condition: service_healthy
    redis:
      condition: service_healthy
```

**What this does:**

- `depends_on:` declares that this service needs other services to start first
- `condition: service_healthy` waits until the dependency passes its healthcheck
- Without `condition`, Docker only waits for the container to *start*, not to be *ready*

**The difference:**

```text
Without health condition:
  1. MySQL container starts (port opens, but database not ready yet)
  2. App container starts immediately
  3. App crashes: "Can't connect to MySQL"

With health condition:
  1. MySQL container starts
  2. Docker runs healthcheck every 5s: "mysqladmin ping"
  3. After ~10-20s, healthcheck passes
  4. App container starts
  5. App connects successfully
```

**Why this matters:**

Without health checks, Docker starts services in dependency order but doesn't wait for them to be *ready*. Your app might try to connect to MySQL before it's accepting connections.

Health checks ensure dependencies are actually ready before starting dependent services.

### 6. YAML Anchors for DRY Configuration

```yaml
x-server-env: &server-env
  RAILS_ENV: production
  NODE_ENV: production
  SECRET_KEY_BASE: "dummy-secret-key-base"
  REDIS_URL: redis://redis:6379/0
  # ... 50+ more env vars

services:
  control-server:
    environment:
      <<: *server-env          # Inherit all shared env vars
      PERF_EXPERIMENT: "false"  # Override/add specific ones
      DATABASE_URL: "...control..."

  experiment-server:
    environment:
      <<: *server-env
      PERF_EXPERIMENT: "true"
      DATABASE_URL: "...experiment..."
```

**What this does:**

| Syntax | What it does |
|--------|--------------|
| `x-server-env:` | A custom extension field (the `x-` prefix means docker-compose ignores it as a service) |
| `&server-env` | Creates an anchor (like saving to a variable) |
| `*server-env` | References the anchor (like reading the variable) |
| `<<:` | Merge operator - inserts all key-value pairs from the referenced anchor |

**How the merge works:**

```yaml
# This:
environment:
  <<: *server-env
  PERF_EXPERIMENT: "true"

# Becomes this (after YAML processing):
environment:
  RAILS_ENV: production
  NODE_ENV: production
  SECRET_KEY_BASE: "dummy-secret-key-base"
  REDIS_URL: redis://redis:6379/0
  PERF_EXPERIMENT: "true"  # Added after the merged values
```

**Why this matters:**

Both servers need identical configuration except for a few values. YAML anchors (`&name`) and aliases (`*name`) let you define shared config once and merge it with `<<:`. This avoids duplicating 50+ environment variables.

## Build Script Patterns

Your build script should pass host UID/GID at build time:

```bash
#!/bin/bash
docker build -t my-app-experiment \
  -f ab-tests/docker/Dockerfile \
  --build-arg UID=$(id -u) \
  --build-arg GID=$(id -g) \
  --build-arg NON_ROOT_USER=$(whoami) \
  --build-arg GIT_SHA=$(git rev-parse --short HEAD) \
  .
```

Key build args:

| Arg | Value | Purpose |
|-----|-------|---------|
| `UID` | `$(id -u)` | Your host user ID |
| `GID` | `$(id -g)` | Your host group ID |
| `NON_ROOT_USER` | `$(whoami)` | Your username (for home directory path) |
| `GIT_SHA` | `$(git rev-parse --short HEAD)` | Track which commit the image was built from |

## CircleCI Configuration

### 1. Machine Executor (NOT Docker Executor)

```yaml
machine-defaults: &machine-defaults
  machine:
    image: ubuntu-2204:2023.10.1
  resource_class: large
```

**What this does:**

| Line | What it does |
|------|--------------|
| `&machine-defaults` | Creates a YAML anchor to reuse this config |
| `machine:` | Use a full virtual machine instead of a Docker container |
| `image: ubuntu-2204:2023.10.1` | Specifies the VM image (Ubuntu 22.04 from Oct 2023) |
| `resource_class: large` | Allocates more CPU/memory to the VM |

**CircleCI executor types:**

| Executor | What it is | Can build Docker images? |
|----------|-----------|-------------------------|
| `docker:` | Your job runs inside a container | Difficult (Docker-in-Docker) |
| `machine:` | Your job runs on a full VM | Yes, natively |

**Why this matters:**

CircleCI's Docker executor runs your job inside a container, which can't easily build Docker images (Docker-in-Docker issues). The machine executor gives you a full VM where Docker works normally.

### 2. Parallel Image Builds

Build control and experiment images in parallel to save time:

```yaml
jobs:
  build-experiment-ci-image:
    <<: *machine-defaults
    steps:
      - checkout
      - run: docker build -t printivity-experiment:${CIRCLE_SHA1} ...
      - run: docker save -o /tmp/docker-images/experiment.tar ...
      - persist_to_workspace:
          root: /tmp
          paths:
            - docker-images/experiment.tar

  build-control-ci-image:
    <<: *machine-defaults
    # Similar steps for control image

workflows:
  perf-test:
    jobs:
      - build-experiment-ci-image
      - build-control-ci-image  # Runs in parallel
      - perf-tests:
          requires:
            - build-experiment-ci-image
            - build-control-ci-image
```

**What this does:**

| Step | What it does |
|------|--------------|
| `checkout` | Clones your repo into the CI environment |
| `docker build -t name:${CIRCLE_SHA1}` | Builds image tagged with the git commit SHA |
| `docker save -o file.tar` | Exports the Docker image to a tarball file |
| `persist_to_workspace` | Saves the tarball so other jobs can access it |
| `requires:` | Makes `perf-tests` wait for both build jobs to finish |

**How parallel jobs work:**

```text
Time →

build-experiment-ci-image: [======building======]
build-control-ci-image:    [======building======]
                                                  ↓ both done
perf-tests:                                       [===running===]
```

Without `requires:`, both build jobs start immediately and run in parallel.

### 3. Git Worktree for Control Branch

```bash
# Checkout control (master) without a full clone
git worktree add /home/circleci/control_checkout $(git merge-base HEAD origin/master)
```

**What this does:**

| Part | What it does |
|------|--------------|
| `git worktree add <path> <commit>` | Creates a new working directory linked to the same repo |
| `/home/circleci/control_checkout` | Where to put the second checkout |
| `$(git merge-base HEAD origin/master)` | The commit to checkout (see below) |

**Understanding `git merge-base`:**

```text
        A---B---C  (your-feature-branch, HEAD)
       /
  D---E---F---G  (origin/master)

git merge-base HEAD origin/master  →  returns commit E
```

This finds the "fork point" — the last commit your branch shares with master. This is your baseline for comparison.

**Why this matters:**

You need two versions of your code: the current branch (experiment) and master (control). Git worktree lets you have both checked out simultaneously without cloning the repo twice.

Using `merge-base` instead of just `origin/master` ensures you're comparing against the master state when you branched off, not the latest master (which might have unrelated changes).

### 4. Workspace Persistence

```yaml
- persist_to_workspace:
    root: /tmp
    paths:
      - docker-images/experiment.tar

# In another job:
- attach_workspace:
    at: /tmp/workspace
- run: docker load -i /tmp/workspace/docker-images/experiment.tar
```

**What this does:**

| Step | What it does |
|------|--------------|
| `persist_to_workspace` | Uploads files to CircleCI's temporary storage |
| `root: /tmp` | The base directory (paths are relative to this) |
| `paths: - docker-images/...` | Which files/folders to upload |
| `attach_workspace` | Downloads the persisted files in a later job |
| `at: /tmp/workspace` | Where to put the downloaded files |
| `docker load -i file.tar` | Imports a Docker image from a tarball |

**The flow:**

```text
Job 1 (build):
  /tmp/docker-images/experiment.tar  →  [persist_to_workspace]  →  CircleCI storage

Job 2 (test):
  CircleCI storage  →  [attach_workspace]  →  /tmp/workspace/docker-images/experiment.tar
                                              ↓
                                         docker load
                                              ↓
                                         Image available locally
```

**Why this matters:**

CircleCI jobs run on different machines. To share the built Docker images between the build job and the test job, you save them to a tarball and persist to the workspace.

### 5. Helper Functions in BASH_ENV

```bash
# In your script
ab-tests/bin/define-helper-functions
# This exports functions to $BASH_ENV

# Now you can use them in subsequent steps
run_cmd_in_experiment_container "bundle exec rails console"
```

**What this does:**

`$BASH_ENV` is a special file that CircleCI sources (runs) before every step. Think of it like `.bashrc` but for CI.

```bash
# Inside define-helper-functions:
run_cmd_in_experiment_container() {
  docker exec -it experiment-server "$@"
}

# Export the function definition to BASH_ENV
echo "run_cmd_in_experiment_container() { docker exec -it experiment-server \"\$@\"; }" >> $BASH_ENV
```

**The flow:**

```text
Step 1: source define-helper-functions
        → Appends function definitions to $BASH_ENV

Step 2: (CircleCI sources $BASH_ENV automatically)
        → Functions are now available

Step 3: run_cmd_in_experiment_container "rails console"
        → Works because function was loaded from $BASH_ENV
```

**Why this matters:**

CircleCI's `$BASH_ENV` file is sourced before each step. Exporting functions there makes them available in all subsequent steps, so you don't have to re-source scripts in every step.

### 6. Background Steps for Servers

```yaml
- run:
    name: Run rails server (control)
    command: run_cmd_in_control_container "bundle exec puma -b tcp://0.0.0.0:3000"
    background: true

- run:
    name: Wait for servers
    command: dockerize -wait http://localhost:3020 -timeout 30s
```

**What this does:**

| Part | What it does |
|------|--------------|
| `background: true` | Start the command and immediately move to next step (don't wait for it to finish) |
| `bundle exec puma -b tcp://0.0.0.0:3000` | Start Puma web server, bind to all interfaces on port 3000 |
| `dockerize -wait http://...` | Keep checking the URL until it responds (or timeout) |
| `-timeout 30s` | Give up after 30 seconds if server doesn't respond |

**The flow:**

```text
Step 1: Start control server (background: true)
        → Starts server, immediately continues to step 2

Step 2: Start experiment server (background: true)
        → Starts server, immediately continues to step 3

Step 3: dockerize -wait http://localhost:3020
        → Blocks here, polling every second
        → Server eventually responds with 200 OK
        → Continues to step 4

Step 4: Run your performance tests
        → Both servers are now ready
```

**Why this matters:**

Servers need to run continuously while tests execute. The `background: true` flag starts the process and moves to the next step without waiting.

Use `dockerize -wait` to block until the server is actually responding before running tests. Without this, your tests might start before the server is ready.

## Quick Checklist

Use this checklist when adapting your existing Dockerfile for twin-servers:

### Dockerfile

- [ ] Add `ARG UID=1000`, `ARG GID=1000`, `ARG NON_ROOT_USER=my_user` at the top
- [ ] Re-declare ARGs after FROM (ARGs don't persist across stages)
- [ ] Add the GID compatibility hack: `RUN getent group $GID | cut -d: -f1 | xargs -r groupdel`
- [ ] Create non-root user with matching UID/GID
- [ ] Use `COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER}` for all COPY commands
- [ ] Set `USER ${NON_ROOT_USER}` before running app commands
- [ ] Remove any `CMD` or `ENTRYPOINT` (let docker-compose handle it)
- [ ] Add dummy credentials for asset precompilation if needed

### docker-compose.yml

- [ ] Define bind-mounted volumes (with `driver_opts: type: none, o: bind`)
- [ ] Create two server services: `control-server` and `experiment-server`
- [ ] Map different external ports (3020 and 3030)
- [ ] Set `PERF_EXPERIMENT` env var differently for each
- [ ] Point each server to its own database
- [ ] Add `command: sleep infinity` to both servers
- [ ] Create separate database services with health checks
- [ ] Use YAML anchors for shared environment variables
- [ ] Add `depends_on` with `condition: service_healthy`

### Build Script

- [ ] Pass `--build-arg UID=$(id -u)`
- [ ] Pass `--build-arg GID=$(id -g)`
- [ ] Pass `--build-arg NON_ROOT_USER=$(whoami)`

### CircleCI (if using)

- [ ] Use machine executor, not Docker executor
- [ ] Build images in parallel jobs
- [ ] Use git worktree for control branch checkout
- [ ] Persist images to workspace with docker save/load
- [ ] Export helper functions to BASH_ENV
- [ ] Use background steps for running servers
- [ ] Use dockerize for health checks before running tests
