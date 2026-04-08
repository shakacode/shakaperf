#!/usr/bin/env python3
"""
Parse visreg_data/html_report/report.json and print a summary of
pass/fail status and diff percentages for each test scenario.

Usage (run from the app directory, e.g. demo-ecommerce/):
  python3 .claude/skills/discover-abtests/scripts/parse-report.py
  python3 .claude/skills/discover-abtests/scripts/parse-report.py visreg_data/html_report/report.json

Or inline (no file needed):
  python3 -c "
import json, sys
data = json.load(open('visreg_data/html_report/report.json'))
for t in data.get('tests', []):
  p = t.get('pair', {})
  status = p.get('status', '?')
  diff = p.get('diff', {}).get('misMatchPercentage', '?')
  label = p.get('label', p.get('fileName', '?'))
  print(f'{status:10} diff={diff}%  {label}')
"
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

print(f"{'STATUS':<10} {'DIFF %':<10} LABEL")
print("-" * 70)

for t in tests:
    pair = t.get('pair', {})
    status = pair.get('status', 'unknown')
    diff_info = pair.get('diff', {})
    diff_pct = diff_info.get('misMatchPercentage', 'n/a')
    label = pair.get('label', pair.get('fileName', 'unknown'))

    print(f"{status:<10} {str(diff_pct) + '%':<10} {label}")

    if status == 'pass':
        pass_count += 1
    else:
        fail_count += 1

print("-" * 70)
print(f"Total: {len(tests)}  Pass: {pass_count}  Fail: {fail_count}")
