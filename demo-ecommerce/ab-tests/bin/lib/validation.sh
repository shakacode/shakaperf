#!/bin/bash
# Validation utility functions for checking prerequisites

# Source colors and UI if not already loaded
if [ -z "$RED" ]; then
  source "$(dirname "${BASH_SOURCE[0]}")/colors.sh"
  source "$(dirname "${BASH_SOURCE[0]}")/ui.sh"
fi

# Check if running from project root directory
# Usage: ensure_project_root
ensure_project_root() {
  if [ ! -f "ab-tests/docker/docker-compose.yml" ]; then
    print_error "Please run this script from the project root directory."
    exit 1
  fi
}

# Check if a command exists
# Usage: require_command "parallel" "sudo apt-get install parallel"
require_command() {
  local cmd="$1"
  local install_hint="$2"
  
  if ! command -v "$cmd" &> /dev/null; then
    print_error "$cmd is not installed."
    if [ -n "$install_hint" ]; then
      echo "Install it with: $install_hint"
    fi
    exit 1
  fi
}

# Check if a directory exists
# Usage: require_directory "../printivity_control" "Instructions on how to create it"
require_directory() {
  local dir="$1"
  local help_text="$2"
  
  if [ ! -d "$dir" ]; then
    print_error "$dir directory not found."
    if [ -n "$help_text" ]; then
      echo ""
      echo "$help_text"
    fi
    exit 1
  fi
}

# Check if a Docker image exists
# Usage: require_docker_image "printivity-experiment"
require_docker_image() {
  local image="$1"
  
  if ! docker image inspect "$image" > /dev/null 2>&1; then
    print_error "Docker image not found: $image"
    echo "   Run ab-tests/bin/build first."
    exit 1
  fi
}

