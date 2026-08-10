---
name: troubleshoot-abtest
description: Debug ONE failing shaka-perf test at ONE viewport by attaching to its live browser — no MCP, no install. `shaka-perf troubleshoot` freezes the visreg + perf browsers open on the failing page; its own subcommands attach over CDP to inspect them. Use whenever a visreg mismatch or perf run needs eyes on the actual page — "why is this test failing", "look at the live page", "debug this abtest", "attach to the troubleshoot browser", "inspect the control vs experiment DOM".
---

# Troubleshooting a failing test on its live browser

`shaka-perf troubleshoot` runs one test at one viewport and leaves its visreg + perf browsers
frozen open on the failing page. Attach and inspect with its own subcommands over CDP — no MCP.

**Run `shaka-perf troubleshoot --help`** — it documents the whole loop (launch → `session` →
`tabs` / `eval` / `html` / `shot` / `console` → kill) and the per-command flags. Follow it.
