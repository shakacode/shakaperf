/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * SPDX-License-Identifier: LicenseRef-ShakaPerf-1.0
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { CSSProperties } from 'react';

export const SCAN_STYLE: CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--bg-sunken)',
  padding: '10px 12px',
};

export const NODE_PRE_STYLE: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  padding: 8,
  margin: '6px 0 0',
};

export const ACCESSIBILITY_FILTER_CSS = `
.a11y-filter {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
.a11y-filter__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--control-height, 34px);
  min-height: var(--control-height, 34px);
  border: 1px solid var(--border-strong);
  background: var(--bg-elevated);
  color: var(--error);
  padding: 0 var(--control-pad-x, 11px);
  cursor: pointer;
  font-size: var(--control-font-size, 11px);
  line-height: 1;
  letter-spacing: var(--control-letter-spacing, 0.08em);
  text-transform: lowercase;
  white-space: nowrap;
}
.a11y-filter__button:hover,
.a11y-filter__button[data-open="true"] {
  border-color: var(--error);
  background: var(--error);
  color: var(--bg);
}
.a11y-filter__button[data-muted="true"]:not(:hover):not([data-open="true"]) {
  border-color: var(--border-strong);
  color: var(--fg-muted);
}
.a11y-filter__menu {
  display: grid;
  grid-template-columns: repeat(2, minmax(170px, 1fr));
  gap: 12px;
  width: min(520px, calc(100vw - 32px));
  max-height: min(420px, 60vh);
  overflow: auto;
  border: 1px solid var(--border-strong);
  background: var(--bg-elevated);
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.22);
  padding: 10px;
  color: var(--fg);
  text-align: left;
}
.a11y-filter[data-variant="popover"] .a11y-filter__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 100;
}
.a11y-filter[data-variant="panel"] {
  display: flex;
  align-items: flex-end;
}
.a11y-filter[data-variant="panel"] .a11y-filter__menu {
  position: static;
  max-height: none;
  overflow: visible;
  box-shadow: none;
  background: var(--bg);
}
.a11y-dialog__filter {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.a11y-dialog__filter .a11y-filter[data-variant="panel"] {
  width: 100%;
}
.a11y-dialog__filter .a11y-filter[data-variant="panel"] .a11y-filter__menu {
  width: 100%;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}
.a11y-filter__section {
  min-width: 0;
}
.a11y-filter__section-title {
  margin-bottom: 5px;
  color: var(--fg-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.a11y-filter__rows {
  display: grid;
  gap: 2px;
}
.a11y-filter__row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 7px;
  align-items: center;
  min-width: 0;
  padding: 3px 0;
  white-space: nowrap;
}
.a11y-filter__row input {
  margin: 0;
}
.a11y-filter__label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.a11y-filter__count {
  color: var(--fg-muted);
  font-size: 10px;
}
.a11y-filter__actions {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--control-gap, 8px);
  padding-top: 2px;
}
.a11y-filter__actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0 8px;
  font-size: 10px;
  line-height: 1;
  color: var(--fg-muted);
}
.a11y-filter__close {
  min-width: 24px;
}
.a11y-filter__close:hover {
  color: var(--fg);
}
@media (max-width: 620px) {
  .a11y-filter__menu {
    grid-template-columns: 1fr;
  }
}
`;

export const ACCESSIBILITY_PREVIEW_CSS = `
.a11y-thumb-button {
  appearance: none;
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: zoom-in;
  text-align: left;
  text-transform: none;
  letter-spacing: normal;
}
.a11y-thumb-button:hover {
  background: transparent;
  color: inherit;
}
.a11y-preview-card {
  display: grid;
  gap: 8px;
  width: min(560px, 100%);
  border: 1px solid var(--border-strong);
  background: var(--bg-elevated);
}
.a11y-preview-card:hover {
  border-color: var(--fg-muted);
}
.a11y-filtered-empty {
  border: 1px dashed var(--border-strong);
  background: var(--bg-elevated);
  color: var(--fg-muted);
  padding: 10px;
  font-size: 11px;
}
.a11y-preview-card__footer {
  display: flex;
  justify-content: flex-end;
  padding: 0 8px 8px;
}
.a11y-raw-link {
  border: 1px solid var(--border-strong);
  color: var(--fg);
  padding: 3px 7px;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.a11y-raw-link:hover {
  border-color: var(--fg-muted);
  background: var(--bg-sunken);
  color: var(--fg);
}
.a11y-thumb {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: stretch;
  padding: 8px;
}
.a11y-thumb__image {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--bg-sunken);
  flex: 0 0 auto;
}
.a11y-thumb__image img {
  display: block;
  width: 100%;
  height: 100%;
}
.a11y-thumb__marker {
  position: absolute;
  min-width: 8px;
  min-height: 8px;
  border: 1px solid #dc2626;
  background: rgba(220, 38, 38, 0.22);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85);
}
.a11y-thumb__summary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
  font-size: 11px;
}
.a11y-thumb__summary-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.a11y-thumb__title {
  font-weight: 700;
}
.a11y-thumb__count {
  color: #b91c1c;
  font-weight: 700;
  white-space: nowrap;
}
.a11y-thumb__rules {
  display: grid;
  gap: 3px;
  color: var(--fg-muted);
}
.a11y-thumb__rule {
  display: flex;
  gap: 5px;
  min-width: 0;
  align-items: baseline;
  flex-wrap: wrap;
}
.a11y-thumb__rule-id {
  flex: 0 0 auto;
  color: var(--fg);
  font-weight: 700;
  white-space: nowrap;
}
.a11y-thumb__rule-impact {
  flex: 0 0 auto;
  font-weight: 700;
  white-space: nowrap;
}
.a11y-tag-chips {
  display: inline-flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 3px;
  min-width: 0;
  vertical-align: middle;
}
.a11y-tag-chip {
  display: inline-flex;
  align-items: center;
  max-width: 110px;
  min-height: 16px;
  padding: 0 5px;
  border: 1px solid rgba(37, 99, 235, 0.45);
  background: rgba(37, 99, 235, 0.08);
  color: #1d4ed8;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.a11y-tag-chip--muted {
  border-color: var(--border-strong);
  background: var(--bg-sunken);
  color: var(--fg-muted);
}
.a11y-thumb__rule-count {
  flex: 0 0 auto;
  color: var(--fg);
  white-space: nowrap;
}
.a11y-thumb__rule-help {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.a11y-thumb__more {
  color: var(--fg-muted);
  font-weight: 700;
}
.a11y-dialog {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
  gap: 12px;
  min-height: 0;
  padding: 12px;
}
.a11y-dialog__shot {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  background: var(--bg-sunken);
}
.a11y-dialog__issues {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  background: var(--bg-sunken);
  padding: 10px;
}
.a11y-dialog__summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.a11y-dialog__summary strong {
  font-size: 12px;
}
.a11y-shot {
  position: relative;
  width: max-content;
  max-width: none;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  overflow: visible;
}
.a11y-shot img {
  display: block;
  max-width: none;
  height: auto;
}
.a11y-hotspot {
  position: absolute;
  min-width: 14px;
  min-height: 14px;
  border: 2px solid #dc2626;
  background: rgba(220, 38, 38, 0.14);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.95), 0 2px 12px rgba(0, 0, 0, 0.22);
  cursor: pointer;
  z-index: 1;
}
.a11y-hotspot[data-impact="critical"],
.a11y-hotspot[data-impact="serious"] {
  border-color: #dc2626;
  background: rgba(220, 38, 38, 0.16);
}
.a11y-hotspot[data-impact="moderate"],
.a11y-hotspot[data-impact="minor"] {
  border-color: #d97706;
  background: rgba(217, 119, 6, 0.18);
}
.a11y-hotspot__num {
  position: absolute;
  top: -11px;
  left: -11px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: #111827;
  color: white;
  font: 700 11px/18px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: center;
}
.a11y-tooltip {
  display: none;
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  width: min(520px, 80vw);
  max-height: 360px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border-strong);
  background: var(--bg-elevated);
  color: var(--fg);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.24);
  z-index: 30;
}
.a11y-hotspot[data-popover-x="left"] .a11y-tooltip {
  left: auto;
  right: 0;
}
.a11y-hotspot[data-popover-y="above"] .a11y-tooltip {
  top: auto;
  bottom: calc(100% + 8px);
}
.a11y-hotspot[data-active="true"] {
  z-index: 1000000 !important;
  outline: 3px solid #2563eb;
  outline-offset: 3px;
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.95),
    0 0 0 7px rgba(37, 99, 235, 0.28),
    0 2px 12px rgba(0, 0, 0, 0.22);
}
.a11y-hotspot:hover,
.a11y-hotspot:focus {
  z-index: 2000000 !important;
  outline: 2px solid #111827;
  outline-offset: 2px;
}
.a11y-hotspot:hover .a11y-tooltip,
.a11y-hotspot:focus .a11y-tooltip {
  display: block;
}
.a11y-tooltip pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 6px 0 0;
  padding: 6px;
  border: 1px solid var(--border);
  background: var(--bg-sunken);
}
.a11y-tooltip__title {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
}
.a11y-tooltip__help {
  color: var(--fg-muted);
  margin: 4px 0 6px;
}
.a11y-rule-group {
  margin-top: 10px;
  border: 1px solid var(--border-strong);
  background: var(--bg-elevated);
}
.a11y-dialog__filter + .a11y-rule-group,
.a11y-dialog__summary + .a11y-rule-group {
  margin-top: 0;
}
.a11y-rule-group[open] {
  background: var(--bg);
}
.a11y-rule-group__summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  padding: 10px 12px;
  cursor: pointer;
  color: var(--fg-muted);
  list-style: none;
}
.a11y-rule-group__summary::-webkit-details-marker {
  display: none;
}
.a11y-rule-group__summary::before {
  content: "";
  width: 0;
  height: 0;
  margin-top: 6px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 7px solid var(--fg-muted);
  transition: transform 120ms ease;
}
.a11y-rule-group[open] > .a11y-rule-group__summary::before {
  transform: rotate(90deg);
}
.a11y-rule-group__summary-main {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.a11y-rule-group__title-row,
.a11y-rule-group__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  min-width: 0;
}
.a11y-rule-group__rule {
  color: var(--fg);
  font-weight: 800;
  overflow-wrap: anywhere;
}
.a11y-rule-group__help {
  color: var(--fg-muted);
  overflow-wrap: anywhere;
}
.a11y-rule-group__meta span {
  border: 1px solid var(--border);
  background: var(--bg);
  padding: 1px 5px;
  font-size: 10px;
  font-weight: 700;
}
.a11y-rule-group[data-active="true"] > .a11y-rule-group__summary {
  background: rgba(37, 99, 235, 0.08);
  box-shadow: inset 3px 0 0 #2563eb;
}
.a11y-rule-group__issues {
  display: grid;
  gap: 8px;
  padding: 0 12px 12px 31px;
}
.a11y-rule-group__docs {
  justify-self: start;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.a11y-issue-node {
  padding: 8px;
  border: 1px solid transparent;
  cursor: pointer;
}
.a11y-issue-node:hover,
.a11y-issue-node:focus {
  border-color: var(--border-strong);
  outline: 0;
  background: var(--bg-elevated);
}
.a11y-issue-node[data-active="true"] {
  border-color: #2563eb;
  background: rgba(37, 99, 235, 0.08);
  box-shadow: inset 3px 0 0 #2563eb;
}
.a11y-hotspot.a11y-flash {
  animation: a11y-hotspot-flash 1200ms ease-out;
}
@keyframes a11y-hotspot-flash {
  0% {
    background: rgba(254, 240, 138, 0.82);
    border-color: #f59e0b;
    box-shadow:
      0 0 0 3px #fef08a,
      0 0 0 10px rgba(250, 204, 21, 0.48),
      0 16px 36px rgba(161, 98, 7, 0.42);
    filter: brightness(1.2);
    transform: scale(1);
  }
  20% {
    background: rgba(253, 224, 71, 0.92);
    border-color: #ca8a04;
    box-shadow:
      0 0 0 5px #facc15,
      0 0 0 16px rgba(250, 204, 21, 0.56),
      0 18px 42px rgba(161, 98, 7, 0.48);
    filter: brightness(1.28);
    transform: scale(1.08);
  }
  55% {
    background: rgba(254, 243, 199, 0.72);
    border-color: #f59e0b;
    box-shadow:
      0 0 0 3px #facc15,
      0 0 0 9px rgba(250, 204, 21, 0.28),
      0 10px 26px rgba(161, 98, 7, 0.26);
  }
  100% {
    background: inherit;
    border-color: inherit;
    box-shadow: inherit;
    filter: brightness(1);
    transform: scale(1);
  }
}
@media (max-width: 860px) {
  .a11y-dialog {
    grid-template-columns: 1fr;
  }
  .a11y-dialog__shot {
    max-height: 62vh;
  }
}
@media (max-width: 540px) {
  .a11y-thumb {
    grid-template-columns: 1fr;
  }
}
`;

export const ACCESSIBILITY_CSS = `
${ACCESSIBILITY_FILTER_CSS}
${ACCESSIBILITY_PREVIEW_CSS}
`;
