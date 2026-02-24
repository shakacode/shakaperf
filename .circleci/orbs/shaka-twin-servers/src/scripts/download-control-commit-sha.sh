#!/usr/bin/env bash
set -euo pipefail

if [ -z "${S3_BUCKET:-}" ]; then
  echo "Error: S3_BUCKET environment variable is required"
  exit 1
fi

S3_KEY="${PARAM_S3_KEY_PREFIX}/git-sha.txt"
S3_URI="s3://${S3_BUCKET}/${S3_KEY}"

aws_cmd() {
  if [ -n "${S3_ENDPOINT:-}" ]; then
    aws s3 --endpoint-url "$S3_ENDPOINT" "$@"
  else
    aws s3 "$@"
  fi
}

tmp_file=$(mktemp)

echo "Downloading control commit SHA from ${S3_URI}..."

if aws_cmd cp "$S3_URI" "$tmp_file" 2>/dev/null; then
  sha=$(tr -d '[:space:]' < "$tmp_file")
  rm -f "$tmp_file"

  # Validate it looks like a SHA
  if ! echo "$sha" | grep -qE '^[0-9a-f]{40}$'; then
    echo "Warning: Invalid SHA format: '$sha'"
    echo "Falling back to HEAD~1"
    sha=$(git rev-parse HEAD~1)
  fi

  # Validate the commit exists in the repo
  if ! git cat-file -t "$sha" >/dev/null 2>&1; then
    echo "Warning: Commit $sha not found in git history"
    echo "Falling back to HEAD~1"
    sha=$(git rev-parse HEAD~1)
  fi

  echo "Control commit SHA: ${sha:0:7} ($sha)"
  echo "export PERF_BASELINE_SHA=$sha" >> "$BASH_ENV"
else
  rm -f "$tmp_file"
  echo "Warning: No control commit SHA found in S3. This appears to be the first run."
  echo "Falling back to HEAD~1 as initial control commit."
  sha=$(git rev-parse HEAD~1)
  echo "Using fallback control commit SHA: ${sha:0:7} ($sha)"
  echo "export PERF_BASELINE_SHA=$sha" >> "$BASH_ENV"
fi
