#!/bin/bash
# Git utility functions for working with changed files

# Get all changed and untracked files (excluding deleted files)
# Usage: get_changed_files
get_changed_files() {
  git diff --name-only --diff-filter=d && git ls-files --others --exclude-standard
}

# Get all changed and untracked files (including deleted files)
# Usage: get_changed_files_with_deleted
get_changed_files_with_deleted() {
  git diff --name-only && git ls-files --others --exclude-standard
}

# Extract unique directory paths from a list of files
# Usage: echo "$FILES" | extract_directories
extract_directories() {
  xargs -I {} dirname {} | sort | uniq
}

