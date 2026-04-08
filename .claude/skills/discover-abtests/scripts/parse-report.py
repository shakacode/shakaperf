#!/usr/bin/env python3
"""
Parse visreg_data/html_report/report.json and print a summary of
pass/fail status, diff percentages, whitespace metrics, and engine errors.

Usage (run from the app directory, e.g. demo-ecommerce/):
  python3 .claude/skills/discover-abtests/scripts/parse-report.py
  python3 .claude/skills/discover-abtests/scripts/parse-report.py visreg_data/html_report/report.json
"""

import json
import sys
import os

report_path = sys.argv[1] if len(sys.argv) > 1 else 'visreg_data/html_report/report.json'

if not os.path.exists(report_path):
    print(f"Report not found: {report_path}", file=sys.stderr)
    sys.exit(1)

with open(report_path) as f:
    data = json.load(f)

tests = data.get('tests', [])
if not tests:
    print("No tests found in report.")
    sys.exit(0)

pass_count = 0
fail_count = 0
high_white_count = 0
engine_error_count = 0
bottom_white_count = 0

header = f"{'STATUS':<10} {'DIFF %':<10} {'WHITE%':<10} {'BOT70W':<8} {'ERROR':<8} LABEL"
print(header)
print("-" * 90)

for t in tests:
    pair = t.get('pair', {})
    status = t.get('status', pair.get('status', 'unknown'))
    diff_info = pair.get('diff', {})
    diff_pct = diff_info.get('misMatchPercentage', 'n/a')
    label = pair.get('label', pair.get('fileName', 'unknown'))

    # Whitespace fields
    white_pct = pair.get('testWhitePixelPercent', pair.get('refWhitePixelPercent'))
    white_str = f"{white_pct:.1f}%" if white_pct is not None else 'n/a'
    bot70 = pair.get('testIsBottomSeventyPercentWhite', pair.get('refIsBottomSeventyPercentWhite'))
    bot70_str = str(bot70).lower() if bot70 is not None else 'n/a'

    # Engine error
    had_error = pair.get('hadEngineError', False)
    error_str = 'YES' if had_error else ''

    # Flags
    flags = []
    if white_pct is not None and white_pct > 90:
        flags.append('HIGH-WHITE')
        high_white_count += 1
    if had_error:
        flags.append('ENGINE-ERR')
        engine_error_count += 1
    if bot70:
        bottom_white_count += 1

    flag_str = f"  <- {', '.join(flags)}" if flags else ''

    print(f"{status:<10} {str(diff_pct) + '%':<10} {white_str:<10} {bot70_str:<8} {error_str:<8} {label}{flag_str}")

    if status == 'pass':
        pass_count += 1
    else:
        fail_count += 1

print("-" * 90)
print(f"Total: {len(tests)}  Pass: {pass_count}  Fail: {fail_count}")

if high_white_count > 0:
    print(f"WARNINGS: {high_white_count} test(s) with whitePixelPercent > 90% (selector may capture empty space)")
if engine_error_count > 0:
    print(f"ERRORS: {engine_error_count} test(s) with engine error (check engineErrorMsg)")
if bottom_white_count > 0:
    print(f"INFO: {bottom_white_count} test(s) with bottom 70% white (content concentrated at top)")
