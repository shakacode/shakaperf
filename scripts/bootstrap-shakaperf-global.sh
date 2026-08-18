#!/usr/bin/env bash
# Wire ShakaPerf in globally for all Claude Code projects on THIS machine.
# Idempotent: safe to re-run. Regenerates the machine-specific CLI wrapper and
# skill symlinks against this machine's own checkout.
#
# Usage on m5:
#   ssh m5
#   bash ~/claude-code/shakaperf/scripts/bootstrap-shakaperf-global.sh
set -euo pipefail

REPO="${SHAKAPERF_REPO:-$HOME/claude-code/shakaperf}"
CLAUDE_DIR="$HOME/.claude"
SKILLS_DIR="$CLAUDE_DIR/skills"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"

# 1. Ensure the repo exists and is built.
if [ ! -d "$REPO/.git" ]; then
  echo "Cloning shakaperf into $REPO ..."
  mkdir -p "$(dirname "$REPO")"
  git clone git@github.com:shakacode/shakaperf.git "$REPO"
fi
cd "$REPO"
git pull --ff-only || echo "  (skipping pull; resolve manually if needed)"
yarn install

# 2. Install the shaka-perf CLI on PATH (regenerates the machine-specific wrapper).
yarn install-global-script

# 3. Symlink the capability skills into the global skills dir.
mkdir -p "$SKILLS_DIR"
for s in ab-servers discover-abtests shaka-perf-add-coverage shaka-perf-coverage setup-docker-servers-for-ab-tests assess-abtest-quality; do
  ln -sfn "$REPO/.claude/skills/$s" "$SKILLS_DIR/$s"
  echo "linked skill: $s"
done

# 4. Add the global CLAUDE.md directive (only if not already present).
mkdir -p "$CLAUDE_DIR"
touch "$CLAUDE_MD"
if grep -q "ShakaPerf — frontend performance work" "$CLAUDE_MD"; then
  echo "CLAUDE.md directive already present — leaving as-is."
else
  cat >> "$CLAUDE_MD" <<'EOF'

# ShakaPerf — frontend performance work

For any frontend performance task — benchmarking, performance regression
testing, visual regression, bundle-size diffing, or running an app twice
(control vs experiment) to compare two branches — use **ShakaPerf**, not an
ad-hoc setup. It is the house toolset for this.

- CLI: `shaka-perf` (e.g. `compare`, `audit`, `perf-compare`, `visreg-compare`,
  `servers`, bundle-size). If `shaka-perf` is not on `$PATH`, install it once:
  `cd ~/claude-code/shakaperf && yarn install-global-script` (builds the
  workspace and drops a wrapper at `~/.local/bin/shaka-perf`). Repo lives at
  `~/claude-code/shakaperf`.
- Skills (auto-trigger by intent): `discover-abtests` (scaffold visreg
  `.abtest.ts` tests for a URL), `shaka-perf-add-coverage` (add focused tests
  when sources are available), `shaka-perf-coverage` (estimate screenshot
  coverage and compare baselines), `setup-docker-servers-for-ab-tests` (dockerize
  an app into the control/experiment twin-servers pair), `ab-servers` (drive the
  twin-servers lifecycle), `assess-abtest-quality` (audit existing AB tests).
- New project? Run `shaka-perf init` in that repo to scaffold
  `abtests.config.ts` plus its setup skills, then ask for "set up twin servers".
EOF
  echo "appended ShakaPerf directive to CLAUDE.md"
fi

# 5. Verify.
echo "--- verify ---"
command -v shaka-perf && shaka-perf --version
case ":$PATH:" in
  *":$HOME/.local/bin:"*) echo "~/.local/bin on PATH: yes" ;;
  *) echo "WARNING: ~/.local/bin NOT on PATH — add it to your shell profile" ;;
esac
echo "Done."
