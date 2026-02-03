#!/bin/bash
# UI utility functions for consistent output formatting

# Source colors if not already loaded
if [ -z "$RED" ]; then
  source "$(dirname "${BASH_SOURCE[0]}")/colors.sh"
fi

# Print a banner header
# Usage: print_banner "My Title"
print_banner() {
  local title="$1"
  echo "=========================================="
  echo "$title"
  echo "=========================================="
}

# Print a success message
# Usage: print_success "Operation completed"
print_success() {
  echo -e "${GREEN}✅ $1${NO_COLOR}"
}

# Print an error message
# Usage: print_error "Something went wrong"
print_error() {
  echo -e "${RED}❌ $1${NO_COLOR}" >&2
}

# Print a warning message
# Usage: print_warning "Be careful"
print_warning() {
  echo -e "${YELLOW}⚠️  $1${NO_COLOR}"
}

# Print an info message
# Usage: print_info "Processing..."
print_info() {
  echo -e "${BLUE}$1${NO_COLOR}"
}

