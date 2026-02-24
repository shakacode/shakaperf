#!/bin/bash

# Run a function in parallel for both experiment and control servers
# with colorful tagged output using GNU parallel.
#
# Usage:
#   source run-for-both-servers-in-parallel.sh
#   my_function() { echo "Running on $1"; }
#   export -f my_function
#   run_for_both_servers_in_parallel my_function

run_for_both_servers_in_parallel() {
  local function_name=$1

  # Colorful prefixes for GNU parallel output
  # Blue for EXPERIMENT, Green for CONTROL
  local parallel_tagstring='{=
    if ($_ eq "experiment") {
      $_ = "\033[1;34m[EXPERIMENT]\033[0m";
    } elsif ($_ eq "control") {
      $_ = "\033[1;32m[CONTROL]\033[0m";
    }
  =}'

  parallel --tagstring "$parallel_tagstring" --line-buffer -j 2 "$function_name" ::: experiment control
}
