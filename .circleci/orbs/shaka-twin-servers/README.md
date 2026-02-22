# shaka-twin-servers CircleCI Orb

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
circleci orb pack .circleci/orbs/shaka-twin-servers > shaka-twin-servers-orb.yml
```

### Validate

Check for syntax errors before publishing:

```bash
circleci orb validate shaka-twin-servers-orb.yml
```

### Publish Dev Version (Mutable)

For testing changes before a release. Dev tags can be overwritten:

```bash
circleci orb publish shaka-twin-servers-orb.yml ramez/shaka-twin-servers@dev:alpha
```

### Publish Release Version (Immutable)

For production use. Semantic versions cannot be overwritten:

```bash
# Bump patch version (1.0.1 -> 1.0.2)
circleci orb publish shaka-twin-servers-orb.yml ramez/shaka-twin-servers@1.0.2

# Or use increment command
circleci orb publish increment shaka-twin-servers-orb.yml ramez/shaka-twin-servers patch
```

## Using the Orb

Reference in your `.circleci/config.yml`:

```yaml
orbs:
  twin-servers: ramez/shaka-twin-servers@1.0.2

workflows:
  perf-tests:
    jobs:
      - twin-servers/build-experiment:
          image-name: my-app
          # Other required params
      - twin-servers/build-control:
          image-name: my-app
          # Other required params
      - twin-servers/run-tests:
          requires:
            - twin-servers/build-experiment
            - twin-servers/build-control
          server-command: 'npm start'
          # Other required params
```

## Local Testing

To test orb changes without publishing:

1. Use inline orb definition in your config (copy packed content)
2. Or publish to a dev tag and reference it: `@dev:my-feature`
