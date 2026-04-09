# shaka-perf CircleCI Orb

A/B performance testing infrastructure for comparing Docker-based application versions. Builds twin Docker images (control from merge-base, experiment from current branch) and runs comparative performance tests.

## How to Update

1. Edit the individual YAML files in `commands/`, `jobs/`, `executors/`, or `examples/`
2. Pack the orb into a single file
3. Validate and publish

## Publishing Commands

### Prerequisites

Install the CircleCI CLI:

```bash
brew install circleci
circleci setup  # Authenticate with your token
```

### Pack the Orb

Combine all component files into a single packed orb:

```bash
circleci orb pack .circleci/orbs/shaka-perf/src > shaka-perf-orb.yml
```

### Validate

Check for syntax errors before publishing:

```bash
circleci orb validate shaka-perf-orb.yml
```

### Publish Dev Version (Mutable)

For testing changes before a release. Dev tags can be overwritten:

```bash
circleci orb publish shaka-perf-orb.yml ramez/shaka-perf@dev:alpha
```

### Publish Release Version (Immutable)

For production use. Semantic versions cannot be overwritten:

```bash
# Bump patch version (1.0.1 -> 1.0.2)
circleci orb publish shaka-perf-orb.yml ramez/shaka-perf@1.0.2

# Or use increment command
circleci orb publish increment shaka-perf-orb.yml ramez/shaka-perf patch
```

## Using the Orb

Reference in your `.circleci/config.yml`:

```yaml
orbs:
  shaka-perf: ramez/shaka-perf@1.0.2

workflows:
  perf-tests:
    jobs:
      - shaka-perf/build-experiment:
          image-name: my-app
          # Other required params
      - shaka-perf/build-control:
          image-name: my-app
          # Other required params
      - shaka-perf/run-tests:
          requires:
            - shaka-perf/build-experiment
            - shaka-perf/build-control
          server-command: 'npm start'
          # Other required params
```

## Scheduled Nightly Perf Tests

The orb supports scheduled A/B testing where an S3-stored commit SHA is used as the control instead of git merge-base. This lets you run nightly or weekly performance tests on the main branch against a known-good control commit.

See [examples/scheduled-workflow.yml](src/examples/scheduled-workflow.yml) for a full config example, or [our demo CI config](../../../config.yml) for a working implementation.

### How It Works

1. A scheduled pipeline triggers with `run-scheduled-perf-tests: true`
2. `build-control` uses `download-control-commit-sha` to fetch the control SHA from S3
3. Tests run against the control and experiment (current HEAD) images
4. If tests pass, `update-control-commit-sha` advances the control to HEAD
5. If tests fail, you can click the `approve-control-update` approval job in the CircleCI UI to acknowledge the regression and advance the control anyway

### CircleCI Setup

To schedule the nightly/weekly trigger, you need to create a **Scheduled Trigger** in the CircleCI UI:

1. Go to your project in **CircleCI** (app.circleci.com)
2. Navigate to **Project Settings** (gear icon)
3. Click **Project Setup** in the left sidebar
4. Click **Schedule +**
5. Fill in:
   - **Name**: e.g. "Nightly Twin Server Tests"
   - **Branch**: `main`
   - **Schedule**: set your desired cron expression (e.g. `0 0 * * *` for midnight UTC)
   - **Pipeline Parameters**: add `run-scheduled-perf-tests` with value `true`
6. Save

### Required Environment Variables

Set these in your CircleCI project settings under **Environment Variables**:

| Variable                | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `AWS_ACCESS_KEY_ID`     | AWS credentials for S3 access                          |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials for S3 access                          |
| `S3_BUCKET`             | S3 bucket name (can also be set inline in setup-steps) |
| `S3_ENDPOINT`           | Custom S3 endpoint for R2, MinIO, etc. (optional)      |

### Pipeline Parameter

Add this parameter to the top of your `.circleci/config.yml`:

```yaml
parameters:
  run-scheduled-perf-tests:
    type: boolean
    default: false
```

Guard your normal workflows so they don't run on scheduled triggers:

```yaml
workflows:
  build-and-test:
    when:
      not: << pipeline.parameters.run-scheduled-perf-tests >>
    jobs:
      # ...your normal jobs
```

## Local Testing

To test orb changes without publishing:

1. Use inline orb definition in your config (copy packed content)
2. Or publish to a dev tag and reference it: `@dev:my-feature`
