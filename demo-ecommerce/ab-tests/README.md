# A/B Performance Testing (Twin Servers)

This directory contains everything related to A/B performance testing using twin servers - running both a control (master branch) and experiment (current branch) version of the application side-by-side for comparison.

## Quick Start (Local)

### Prerequisites

1. Docker and docker-compose installed
2. A sibling directory `../printivity_control` with the master branch checked out
3. GNU parallel installed (for database setup)
4. Overmind installed (for running servers)

### Setup and Run

```bash
# 1. Build Docker images
ab-tests/bin/build

# 2. Start containers
ab-tests/bin/start-containers

# 3. (Optional) Start Rails servers via Overmind
ab-tests/bin/start-servers

# 4. (Optional). After changing TS files, copy the changes to the containers and recompile.
#    For experiment
A. Stop the servers (step .3)
B. cd ~/printivity_experiment
C. Make some changes to the code
D. Docker images have their own directories! Changes to ~/printivity_experiment will not be reflected in the docker image automatically.
   ab-tests/bin/copy-local-changes-to-another-directory ~/printivity_experiment_docker_volume/
E. Recompile assets
   ab-tests/bin/assets-precompile experiment
F. Start the servers again (step .3)

# 5. Stop everything when done
ab-tests/bin/stop
```

After starting, servers will be available at:
- **Control Server:** http://localhost:3020
- **Experiment Server:** http://localhost:3030

## Usage with CircleCI

The twin servers setup is integrated into CircleCI via the `perf-test-twin-servers` workflow.

To debug a CI run:
1. Rerun the job with SSH enabled
2. To copy local changes to CI containers, use `ab-tests/bin/copy-local-changes-to-ssh -p <PORT> <HOST>`
     Note: you may need to restart the servers after copying changes to CI containers:
     ```bash
        # Within your SSH session
        cd project
        run_cmd_in_experiment_container bash
          # bash shell inside the experiment container
          ps -ef # identify the process id of the server you want to restart
          kill <process_id>
          # Then start the server again. E.G:
          bundle exec puma -C config/puma.rb -b tcp://0.0.0.0:3000
     ```
3. Use `ab-tests/bin/forward-ports-to-ci-ab-tests -p <PORT> <HOST>` to forward ports locally
4. Access the servers at localhost:3020 and localhost:3030

## Helper Functions for Interactive Use

Get useful bash functions in your shell:
```bash
source ab-tests/bin/define-helper-functions

# Then you can use:
run_cmd_in_experiment_container "ls -la"
run_cmd_in_control_container "bundle exec rails console"
run_cmd_in_experiment_container bash
```

## Architecture

### Control vs Experiment

- **Control:** Built from master branch by default (baseline for comparison)
- **Experiment:** Built from current branch (the code changes being tested)

### Ports

- Control server: 3020 (external), 3000 (container)
- Experiment server: 3030 (external), 3000 (container)
- MySQL (control): mysql2://root@mysql-control:3306/printivity_development
- MySQL (experiment): mysql2://root@mysql-experiment:3306/printivity_development  
- Redis (Shared between both servers): redis://redis:6379/0

### Environment Variables

Both servers share the same environment configuration defined in `docker-compose.yml`. The only differences:
- `PERF_EXPERIMENT`: "false" for control, "true" for experiment
- Database connections point to different MySQL instances

