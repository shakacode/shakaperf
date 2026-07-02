#!/usr/bin/env ruby
# frozen_string_literal: true
# Copyright (c) 2026 ShakaCode LLC
# Licensed under the Business Source License 1.1. See LICENSE for terms.

require "open3"
require "optparse"

HEADER_MARKER = "Licensed under the Business Source License 1.1. See LICENSE for terms."

HEADERS = {
  ".cjs" => "// Copyright (c) 2026 ShakaCode LLC\n// #{HEADER_MARKER}\n\n",
  ".js" => "// Copyright (c) 2026 ShakaCode LLC\n// #{HEADER_MARKER}\n\n",
  ".jsx" => "// Copyright (c) 2026 ShakaCode LLC\n// #{HEADER_MARKER}\n\n",
  ".mjs" => "// Copyright (c) 2026 ShakaCode LLC\n// #{HEADER_MARKER}\n\n",
  ".rb" => "# Copyright (c) 2026 ShakaCode LLC\n# #{HEADER_MARKER}\n\n",
  ".ts" => "// Copyright (c) 2026 ShakaCode LLC\n// #{HEADER_MARKER}\n\n",
  ".tsx" => "// Copyright (c) 2026 ShakaCode LLC\n// #{HEADER_MARKER}\n\n"
}.freeze

RUBY_MAGIC_COMMENT = /\A#\s*(?:frozen_string_literal|encoding|coding):/.freeze

SKIP_PATTERNS = [
  %r{\A\.claude/},
  %r{\A\.yarn/},
  %r{\Ademo-ecommerce/app/assets/config/manifest\.js\z},
  %r{\Ademo-ecommerce/app/javascript/packs/server-bundle\.js\z},
  %r{\Ademo-ecommerce/config/},
  %r{\Ademo-ecommerce/db/schema\.rb\z},
  %r{\Aintegration-tests/snapshots/},
  %r{\Apackages/shaka-shared/},
  %r{\Apackages/shaka-perf/src/bench/cli/static/chartjs-2\.9\.3-chart\.min\.js\z},
  %r{\Aplaywright\.integration\.config\.ts\z},
  %r{(?:\A|/)abtests\.config\.ts\z},
  %r{(?:\A|/)admin\.bundle-size\.config\.ts\z},
  %r{(?:\A|/)bundle-size\.config\.js\z},
  %r{(?:\A|/)jest\.config\.js\z},
  %r{(?:\A|/)postcss\.config\.js\z},
  %r{(?:\A|/)vite\.config\.ts\z}
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
    ":(top)*.rb",
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

  if lines[index]&.start_with?("#!")
    offset += lines[index].length
    index += 1
  end

  while lines[index]&.match?(RUBY_MAGIC_COMMENT)
    offset += lines[index].length
    index += 1
  end

  offset
end

def has_license_header?(contents, header)
  header_body = contents.byteslice(header_insert_offset(contents)..) || ""
  header_body = header_body.sub(/\A\n/, "")

  header_body.start_with?(header) || header_body == header.delete_suffix("\n")
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
  header = HEADERS.fetch(File.extname(path))
  has_license_header?(file_contents.fetch(path), header)
end

if options[:check]
  if missing.empty?
    puts "BSL source headers OK (#{files.length} files checked)"
    exit 0
  end

  warn "Missing BSL source headers in #{missing.length} of #{files.length} files:"
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
