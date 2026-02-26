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

sha=$(git rev-parse HEAD)
echo "Uploading control commit SHA to ${S3_URI}..."
echo -n "$sha" | aws_cmd cp - "$S3_URI"
echo "Control commit SHA updated to: ${sha:0:7} ($sha)"
