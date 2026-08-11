# `shaka-perf troubleshoot`

Debug ONE test at ONE viewport. Each stage freezes once its browser is up, so the
visreg + perf browsers stay live for inspection and nothing tears them down. It
writes no report and yields no perf numbers — use `compare` to measure.

```bash
shaka-perf troubleshoot --filter '^Cart$' --viewport desktop                 # windows, for you
shaka-perf troubleshoot --filter '^Cart$' --viewport desktop --headed=false  # endpoints, for an agent
```

visreg and perf are independent tracks: each browser appears when its own stage
reaches it, and a visreg failure doesn't skip perf.

**Run `shaka-perf troubleshoot --help`** for everything else — the options, the
attach-over-CDP subcommands (`session`, `eval`, `html`, `shot`, `console`), the full
debug loop, and how to stop a session. The bundled `troubleshoot-abtest` skill points
agents at it.
