# AGENTS.md

## Agent Workflow Configuration

Before running repository commands, run `nvm use` in the repository root to activate the Node.js version specified by the project.

Portable shared skills resolve this repo's commands and policy through:
- **Commands** — run `.agents/bin/<name>` (`setup`, `validate`, `test`, ...); see `.agents/bin/README.md`. A missing script means that capability is n/a here.
- **Policy / config** — `.agents/agent-workflow.yml`.
