/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// CSS for the tab bar (shared by the Accessibility + Agent Ready tabs) and the
// Agent Ready panel. Kept in its own module so client-report.ts can include the
// tab chrome whenever ANY extra tab exists, not only when accessibility data is
// present. Appended to the report's <style> only when there is extra-tab data, so
// a Performance-only report stays byte-for-byte identical.

// The tab chrome (bar + panels). Extracted verbatim from the original a11yStyles
// so a Performance+Accessibility report is unchanged; the Agent Ready tab reuses it.
export function tabStyles(): string {
  return `
  /* ---- tabs: Performance | Accessibility | Agent Ready ---- */
  .tabs{display:flex; gap:4px; border-bottom:1px solid var(--line); margin:0 0 22px; flex-wrap:wrap}
  .tab{appearance:none; background:none; border:0; font:inherit; font-weight:600; font-size:15px;
    color:var(--muted); padding:11px 16px; cursor:pointer; border-bottom:2px solid transparent;
    margin-bottom:-1px; display:inline-flex; align-items:center; gap:7px}
  .tab:hover{color:var(--ink)}
  .tab[aria-selected="true"]{color:var(--ink); border-bottom-color:var(--accent)}
  .tab-pill{display:inline-block; min-width:20px; padding:1px 7px; border-radius:999px;
    background:var(--poor-bg); color:#a82f36; font-size:12px; font-weight:700; line-height:18px; text-align:center}
  .tab[aria-selected="true"] .tab-pill{background:var(--poor); color:#fff}
  .tab-panel[hidden]{display:none}

  @media print{
    .tab-panel[hidden]{display:block !important}
  }`;
}

// Agent Ready panel styling. Mirrors the accessibility panel's visual language
// (score badge, checklist dots, cards) so the three tabs feel like one report.
export function agentStyles(): string {
  return `
  /* ---- Agent Ready panel ---- */
  /* bucket-coloured score pill in the tab (a count would read as "issues") */
  .tab-pill--good{background:var(--good-bg); color:#137a43}
  .tab[aria-selected="true"] .tab-pill--good{background:var(--good); color:#fff}
  .tab-pill--fair{background:var(--fair-bg); color:#9a5a12}
  .tab[aria-selected="true"] .tab-pill--fair{background:var(--fair); color:#fff}
  .tab-pill--poor{background:var(--poor-bg); color:#a82f36}
  .tab[aria-selected="true"] .tab-pill--poor{background:var(--poor); color:#fff}

  .ag-card,.ag-access{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:22px 22px 20px; margin:0 0 18px}
  .ag-card .card-head,.ag-access .card-head{align-items:flex-start}
  .ag-score{flex:none; text-align:center; border-radius:12px; padding:8px 12px; min-width:72px; border:1px solid}
  .ag-score__num{font-size:26px; font-weight:800; line-height:1}
  .ag-score__lbl{font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; margin-top:3px; opacity:.8}
  .ag-score--good{background:var(--good-bg); border-color:#bfe6cd; color:#137a43}
  .ag-score--fair{background:var(--fair-bg); border-color:#f0d9b8; color:#9a5a12}
  .ag-score--poor{background:var(--poor-bg); border-color:#f1c7cb; color:#a82f36}

  /* Overall hero (the headline number) + the two factor stats beneath it, so the
     total and its parts read as total-and-parts, not three look-alike numbers. */
  .ag-hero{text-align:center; margin:6px 0 2px}
  .ag-hero__num{font-size:52px; font-weight:800; line-height:1}
  .ag-hero__num.good{color:var(--good)} .ag-hero__num.fair{color:var(--fair)} .ag-hero__num.poor{color:var(--poor)}
  .ag-hero__lbl{font-size:15px; font-weight:600; color:var(--ink); margin-top:5px}
  .ag-hero__verdict{font-weight:700}
  .ag-hero__verdict.good{color:var(--good)} .ag-hero__verdict.fair{color:var(--fair)} .ag-hero__verdict.poor{color:var(--poor)}
  .ag-factors__cap{text-align:center; font-size:11.5px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:14px 0 7px}
  .ag-factors{display:flex; flex-wrap:wrap; justify-content:center; margin-top:0}
  .ag-factors .stat{flex:0 1 300px}

  /* the AI site-specific note shown under the intro */
  .ag-sitenote{font-size:15.5px; color:#3b434e; margin:-6px 0 14px; padding-left:13px; border-left:3px solid var(--line)}
  .ag-summary{font-size:16px; line-height:1.55; color:#2c333c; margin:8px 0 14px}
  .ag-capnote{font-size:14.5px; line-height:1.5; color:#5a626d; margin:0 0 14px; padding-left:13px; border-left:3px solid var(--fair)}
  .ag-wedge{font-size:15.5px; line-height:1.55; color:#3b434e; margin:0 0 18px; padding:12px 14px; background:#f4f7fb; border-radius:8px}
  .ag-wedge b{color:var(--ink)}
  /* the robots-blocks-everything verdict: same shape, alarm tint so it reads as the headline fact */
  .ag-wedge--alarm{background:var(--poor-bg); border-left:3px solid var(--poor)}
  .ag-wedge--alarm b{color:#a82f36}

  .ag-fixes{margin:14px 0 4px}
  .ag-fixes h3{font-size:14px; font-weight:700; color:var(--ink); margin:0 0 8px}
  .ag-fixes ul{margin:0; padding-left:20px}
  .ag-fixes li{font-size:15.5px; line-height:1.5; color:#3b434e; margin:0 0 6px}

  details.ag-detail{margin:8px 0 0; border-top:1px solid var(--line); padding-top:10px}
  details.ag-detail > summary{cursor:pointer; font-size:14.5px; font-weight:600; color:#48515c; list-style:none; display:flex; align-items:center; gap:8px}
  details.ag-detail > summary::-webkit-details-marker{display:none}
  details.ag-detail > summary::before{content:"\\25B8"; color:var(--muted); font-size:11px}
  details.ag-detail[open] > summary::before{content:"\\25BE"}
  details.ag-detail > summary .ag-detail__hint{font-weight:400; color:var(--muted); font-size:13px}

  .ag-cats{margin:12px 0 0}
  .ag-cat{margin:0 0 12px}
  .ag-cat__head{display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin:0 0 4px}
  .ag-cat__name{font-size:14.5px; font-weight:600; color:var(--ink)}
  .ag-cat__pts{font-size:15px; font-weight:700}
  .ag-cat__pts--good{color:var(--good)} .ag-cat__pts--fair{color:var(--fair)} .ag-cat__pts--poor{color:var(--poor)}
  .ag-cat__of{font-size:11px; font-weight:500; color:var(--muted)}

  .ag-checks{list-style:none; margin:0; padding:0}
  .ag-check{display:flex; gap:9px; align-items:flex-start; font-size:14.5px; color:#3b434e; padding:5px 0; line-height:1.45}
  .ag-check__tx{flex:1 1 auto}
  .ag-dot{flex:none; width:9px; height:9px; border-radius:50%; margin-top:6px}
  .ag-dot--ok{background:var(--good)} .ag-dot--mid{background:var(--fair)} .ag-dot--bad{background:var(--poor)}
  .ag-dot--na{background:#c3c8d0}

  @media print{
    .ag-card,.ag-access{break-inside:avoid}
  }`;
}
