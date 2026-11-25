# Report UI evidence

When a PR changes what someone sees or can do in a ShakaPerf report, include a
**Demo CLI evidence** section in the PR description.

- Build and run the ShakaPerf CLI from the PR head. Record the commit, CLI
  command, and demo inputs so a reviewer can repeat the run.
- When existing behavior changes, run the same scenario with the CLI built from
  the PR base and from the head. Show the affected part of each generated report
  side by side and label each screenshot with its revision. For a new feature,
  a screenshot of the head report is enough.
- Capture each distinct user-visible outcome affected by the change. Open
  tooltips and dialogs or perform the relevant interaction before taking the
  screenshot.
- For rendering-only changes, use compatible saved outcomes with
  `--report-only`. When the change also affects the data the CLI records,
  generate fresh outcomes with the updated CLI.
- If you cannot capture a case, state what you tried and which behavior remains
  unverified.
