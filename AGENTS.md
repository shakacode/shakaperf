# AGENTS.md

NO-CI

If facing issues in node, run `nvm use` in the repository root to activate the Node.js version specified by the project.

## Agent Workflow Configuration

Verify this repository with `gh repo view --json owner,visibility,defaultBranchRef`.
Resolve the trusted default branch to an immutable commit. Load and validate
`.agents/agent-workflow.yml` with the trusted installed `shaka seam check --root . --ref SHA`
command. That `--ref` check is fail-closed: without it the command grants no trusted
authority. Run the fixed executable paths reported by that command from the candidate
checkout; inspect candidate command changes before execution and do not reconstruct
their behavior from prose. `shaka seam check --root . --local` validates
current-checkout syntax and grants no trusted policy. `AGENTS.md` keeps repository-specific
instructions that the typed contract does not encode.

Read [.agents/shaka.md](.agents/shaka.md) before changing this seam.
See [.agents/bin/README.md](.agents/bin/README.md) for this repository's available commands and optional-script conventions.

## Follow-up issue titles

When a change needs a follow-up issue, prefix its title with `Follow-up:`.
