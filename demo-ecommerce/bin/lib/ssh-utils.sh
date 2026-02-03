#!/bin/bash
# SSH utility functions for CircleCI debugging

# Parse and validate SSH arguments in the format: -p <PORT> <HOST>
# Usage: parse_ssh_args "$@"
# Sets: SSH_PORT, SSH_HOST
parse_ssh_args() {
  if [ $# -ne 3 ]; then
    echo "❌ Error: Incorrect number of arguments"
    echo ""
    print_ssh_usage "$0"
    exit 1
  fi

  if [ "$1" != "-p" ]; then
    echo "❌ Error: First argument must be '-p'"
    echo "Usage: $0 -p <SSH_PORT> <SSH_HOST>"
    exit 1
  fi

  SSH_PORT="$2"
  SSH_HOST="$3"

  if [ -z "$SSH_PORT" ] || [ -z "$SSH_HOST" ]; then
    echo "❌ Error: SSH port and host are required"
    echo "Usage: $0 -p <SSH_PORT> <SSH_HOST>"
    exit 1
  fi
}

print_ssh_usage() {
  local script_name="$1"
  echo "Usage: $script_name -p <SSH_PORT> <SSH_HOST>"
  echo ""
  echo "Example:"
  echo "  $script_name -p 54782 18.210.27.22"
  echo ""
  echo "To get the correct arguments:"
  echo "1. Go to your CircleCI job"
  echo "2. Click 'Rerun job with SSH'"
  echo "3. Copy the SSH command from the job logs"
  echo "4. Use the -p and host arguments from that command"
  echo ""
  echo "The SSH command will look like:"
  echo "  ssh -p <PORT> <HOST>"
  echo ""
  echo "Use it like:"
  echo "  $script_name -p <PORT> <HOST>"
}

