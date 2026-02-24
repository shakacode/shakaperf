#!/usr/bin/env bash
#
# Manages the perf test baseline commit SHA in S3.
#
# The baseline is a single text file in S3 containing the 40-character SHA
# of the last commit where perf tests passed on the main branch.
#
# Usage:
#   perf-test-baseline.sh download   Download baseline SHA, set $PERF_BASELINE_SHA
#   perf-test-baseline.sh upload     Upload current HEAD as new baseline
#
# Environment variables:
#   S3_BUCKET           S3 bucket name (required)
#   S3_ENDPOINT         Custom S3 endpoint for R2 etc. (optional)
#   AWS_ACCESS_KEY_ID   AWS credentials
#   AWS_SECRET_ACCESS_KEY

set -euo pipefail

if [ -z "${S3_BUCKET:-}" ]; then
  echo "Error: S3_BUCKET environment variable is required"
  exit 1
fi
BUCKET="$S3_BUCKET"
S3_KEY="perf-test-baseline/baseline-git-sha.txt"
S3_URI="s3://${BUCKET}/${S3_KEY}"

aws_cmd() {
  if [ -n "${S3_ENDPOINT:-}" ]; then
    aws s3 --endpoint-url "$S3_ENDPOINT" "$@"
  else
    aws s3 "$@"
  fi
}

cmd_download() {
  local tmp_file
  tmp_file=$(mktemp)

  echo "Downloading perf test baseline from ${S3_URI}..."

  if aws_cmd cp "$S3_URI" "$tmp_file" 2>/dev/null; then
    local sha
    sha=$(tr -d '[:space:]' < "$tmp_file")
    rm -f "$tmp_file"

    # Validate it looks like a SHA
    if ! echo "$sha" | grep -qE '^[0-9a-f]{40}$'; then
      echo "Warning: Invalid baseline SHA format: '$sha'"
      echo "Falling back to HEAD~1"
      sha=$(git rev-parse HEAD~1)
    fi

    # Validate the commit exists in the repo
    if ! git cat-file -t "$sha" >/dev/null 2>&1; then
      echo "Warning: Baseline commit $sha not found in git history"
      echo "Falling back to HEAD~1"
      sha=$(git rev-parse HEAD~1)
    fi

    echo "Perf test baseline SHA: ${sha:0:7} ($sha)"
    echo "export PERF_BASELINE_SHA=$sha" >> "$BASH_ENV"
  else
    rm -f "$tmp_file"
    echo "Warning: No perf test baseline found in S3. This appears to be the first run."
    echo "Falling back to HEAD~1 as initial baseline."
    local sha
    sha=$(git rev-parse HEAD~1)
    echo "Using fallback baseline SHA: ${sha:0:7} ($sha)"
    echo "export PERF_BASELINE_SHA=$sha" >> "$BASH_ENV"
  fi
}

cmd_upload() {
  local sha
  sha=$(git rev-parse HEAD)

  echo "Uploading perf test baseline to ${S3_URI}..."
  echo -n "$sha" | aws_cmd cp - "$S3_URI"
  echo "Perf test baseline updated to: ${sha:0:7} ($sha)"
}

case "${1:-}" in
  download)
    cmd_download
    ;;
  upload)
    cmd_upload
    ;;
  *)
    echo "Usage: perf-test-baseline.sh <download|upload>"
    exit 1
    ;;
esac
