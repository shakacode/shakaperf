#!/usr/bin/env bash
# Embarrasingly some of the contributors enabled low-quality AI review bots in shakaperf ignoring my protests.
# This is a clean up. You are free to use AI reviewing tools locally, but you have to:
# 1. Understand what you are doing
# 2. Self-review carefully
# 3. Think critically
# 4. Resist stupid AI suggestions
#
# Usage:
#   scripts/pest-control.sh [--dry-run] [--state open|closed|all]
#                                        [--limit N] [--authors login,login,...]
#
# Covers both comment kinds a bot can leave: conversation comments (the PR
# timeline) and inline review comments (on diff lines). Submitted review
# bodies cannot be deleted through the GitHub API, so those stay.
#
# Every PR visited and every comment deleted (or that would be, with
# --dry-run) is logged with its URL.
set -euo pipefail

DRY_RUN=0
STATE=all
LIMIT=200
AUTHORS="coderabbitai[bot],greptile-apps[bot],claude[bot]"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --state) STATE="$2"; shift ;;
    --limit) LIMIT="$2"; shift ;;
    --authors) AUTHORS="$2"; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
AUTHORS_JSON=$(printf '%s' "$AUTHORS" | jq -Rc 'split(",") | map(select(length > 0))')
# --paginate concatenates one JSON array per page; slurp them into one stream.
MATCH_FILTER='.[] | select(.user.login as $l | $authors | index($l)) | [.id, .user.login, .created_at, .html_url, (.body | @base64)] | @tsv'

echo "Repo: $REPO"
echo "Authors: $AUTHORS"
[ "$DRY_RUN" = 1 ] && echo "DRY RUN: nothing will be deleted"

deleted=0
seen=0

log_comment() {
  local verb=$1 login=$2 created=$3 url=$4 body_b64=$5
  echo "  $verb [$login] $created $url"
  printf '%s\n' "$(printf '%s' "$body_b64" | base64 -d)" | sed 's/^/    | /'
}

delete_comment() {
  local endpoint=$1 login=$2 created=$3 url=$4 body_b64=$5
  seen=$((seen + 1))
  if [ "$DRY_RUN" = 1 ]; then
    log_comment "would delete" "$login" "$created" "$url" "$body_b64"
    return
  fi
  if gh api -X DELETE "$endpoint" >/dev/null; then
    deleted=$((deleted + 1))
    log_comment "deleted" "$login" "$created" "$url" "$body_b64"
  else
    echo "  FAILED to delete [$login] $created $url" >&2
  fi
}

for pr in $(gh pr list --state "$STATE" --limit "$LIMIT" --json number -q '.[].number'); do
  pr_url="https://github.com/$REPO/pull/$pr"
  echo "PR #$pr $pr_url"

  # Conversation (timeline) comments live under the issues API.
  while IFS=$'\t' read -r id login created url body_b64; do
    [ -n "$id" ] || continue
    delete_comment "repos/$REPO/issues/comments/$id" "$login" "$created" "$url" "$body_b64"
  done < <(gh api --paginate "repos/$REPO/issues/$pr/comments" | jq -r "$MATCH_FILTER" --argjson authors "$AUTHORS_JSON")

  # Inline review comments on diff lines.
  while IFS=$'\t' read -r id login created url body_b64; do
    [ -n "$id" ] || continue
    delete_comment "repos/$REPO/pulls/comments/$id" "$login" "$created" "$url" "$body_b64"
  done < <(gh api --paginate "repos/$REPO/pulls/$pr/comments" | jq -r "$MATCH_FILTER" --argjson authors "$AUTHORS_JSON")
done

echo
if [ "$DRY_RUN" = 1 ]; then
  echo "Would delete $seen comment(s)."
else
  echo "Deleted $deleted of $seen matching comment(s)."
fi
