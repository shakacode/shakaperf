#!/usr/bin/env ruby
# frozen_string_literal: true
# Copyright (c) 2026 ShakaCode LLC.
#
# This file is part of ShakaPerf. Use is governed by The ShakaPerf
# License in LICENSE.md.

require "open3"
require "optparse"

# Substring that identifies the header. Kept short so reflowing the sentence
# across lines does not make an existing header look missing.
HEADER_MARKER = "This file is part of ShakaPerf."

BLOCK_HEADER = <<~HEADER
  /*
   * Copyright (c) 2026 ShakaCode LLC.
   *
   * This file is part of ShakaPerf. Use is governed by The ShakaPerf
   * License in LICENSE.md.
   */

HEADER

# JS/TS only. No Ruby file in this repo carries a source header - the Rails
# demo app is illustrative, not part of the licensed toolkit.
HEADERS = {
  ".cjs" => BLOCK_HEADER,
  ".js" => BLOCK_HEADER,
  ".jsx" => BLOCK_HEADER,
  ".mjs" => BLOCK_HEADER,
  ".ts" => BLOCK_HEADER,
  ".tsx" => BLOCK_HEADER
}.freeze

SKIP_PATTERNS = [
  %r{\A\.claude/},
  %r{\A\.yarn/},
  %r{\Aintegration-tests/snapshots/},
  # Vendored MIT-licensed source; preserve its upstream file-level notice.
  %r{\Apackages/shaka-perf/src/bench/cli/static/chartjs-2\.9\.3-chart\.min\.js\z},
  # Copied verbatim into a consumer's project by `shaka-perf init`, so it must
  # not carry our header.
  %r{\Apackages/shaka-perf/templates/}
].freeze

REPO_ROOT = begin
  stdout, stderr, status = Open3.capture3("git", "rev-parse", "--show-toplevel")
  abort(stderr.empty? ? "Unable to find git repository root" : stderr) unless status.success?

  stdout.strip
end

options = {
  check: false,
  dry_run: false
}

OptionParser.new do |parser|
  parser.banner = "Usage: ruby scripts/update-license-headers.rb [options]"

  parser.on("--check", "Exit non-zero if any selected file is missing the header") do
    options[:check] = true
  end

  parser.on("--dry-run", "List files that would be updated without writing changes") do
    options[:dry_run] = true
  end
end.parse!

def tracked_source_files
  stdout, stderr, status = Open3.capture3(
    "git",
    "-C",
    REPO_ROOT,
    "ls-files",
    "--full-name",
    ":(top)*.cjs",
    ":(top)*.js",
    ":(top)*.jsx",
    ":(top)*.mjs",
    ":(top)*.ts",
    ":(top)*.tsx"
  )
  abort(stderr.empty? ? stdout : stderr) unless status.success?

  stdout.lines.map(&:strip).reject(&:empty?)
end

def repo_path(path)
  File.join(REPO_ROOT, path)
end

def selected_file?(path)
  return false unless HEADERS.key?(File.extname(path))

  SKIP_PATTERNS.none? { |pattern| pattern.match?(path) }
end

def regular_file?(path)
  File.lstat(repo_path(path)).file?
rescue Errno::ENOENT
  false
end

def header_insert_offset(contents)
  offset = 0
  lines = contents.lines
  index = 0

  offset += lines[index].length if lines[index]&.start_with?("#!")

  offset
end

def has_license_header?(contents)
  header_body = contents.byteslice(header_insert_offset(contents)..) || ""
  header_body = header_body.sub(/\A\n/, "")
  leading_comment = header_body.match(/\A\/\*.*?\*\//m)&.[](0)

  leading_comment&.include?(HEADER_MARKER) || false
end

def insert_header(contents, header)
  return header.delete_suffix("\n") if contents.empty?

  offset = header_insert_offset(contents)
  prefix = contents.byteslice(0, offset)
  suffix = contents.byteslice(offset..) || ""

  if offset.positive?
    "#{prefix}#{header}#{suffix.sub(/\A\n/, "")}"
  else
    "#{header}#{contents}"
  end
end

files = tracked_source_files.select { |path| selected_file?(path) && regular_file?(path) }
file_contents = files.to_h { |path| [path, File.read(repo_path(path), encoding: "UTF-8")] }
missing = files.reject do |path|
  has_license_header?(file_contents.fetch(path))
end

if options[:check]
  if missing.empty?
    puts "License headers OK (#{files.length} files checked)"
    exit 0
  end

  warn "Missing license headers in #{missing.length} of #{files.length} files:"
  warn missing.join("\n")
  exit 1
end

if options[:dry_run]
  puts "Would update #{missing.length} of #{files.length} selected files"
  puts missing.join("\n") unless missing.empty?
  exit 0
end

missing.each do |path|
  header = HEADERS.fetch(File.extname(path))
  File.write(repo_path(path), insert_header(file_contents.fetch(path), header))
end

puts "Updated #{missing.length} of #{files.length} selected files"
