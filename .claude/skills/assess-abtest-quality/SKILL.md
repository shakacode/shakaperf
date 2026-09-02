---
name: assess-abtest-quality
description: Audit existing .abtest.ts files plus the latest `shaka-perf audit` results for anti-patterns, false-positive PASSes (blank/high-whitespace screenshots), and coverage gaps. Use whenever the user wants to review, audit, improve, or "assess quality" of AB tests — phrasings like "are my visreg tests any good?", "check the ab tests", "why is this test passing?", or "make these tests more reliable".
argument-hint: "[testFile-or-glob] [--no-run]"
---

# assess-abtest-quality

Create an Opus subagent for each rule you can find in:
https://github.com/shakacode/shakaperf/blob/main/writing-good-ab-tests.md

Subagents must hunt for violations across the existing tests.
