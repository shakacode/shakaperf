/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Shared by React reports and the standalone timeline. Keep this function
// self-contained: the timeline embeds its compiled source in the generated HTML.
export function attachReportTooltip(button: HTMLButtonElement, explanation: string): () => void {
  let tooltip: HTMLDivElement | null = null;
  const handlers = {
    place() {
      if (!tooltip) return;
      const anchor = button.getBoundingClientRect();
      const box = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12))}px`;
      tooltip.style.top = `${anchor.bottom + 8 + box.height <= window.innerHeight - 12
        ? anchor.bottom + 8 : Math.max(12, anchor.top - box.height - 8)}px`;
    },
    open() {
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = `${button.id}-tooltip`;
        tooltip.className = 'report-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.textContent = explanation;
        (button.closest('dialog') ?? document.body).appendChild(tooltip);
        button.setAttribute('aria-describedby', tooltip.id);
      }
      handlers.place();
    },
    close() {
      tooltip?.remove();
      tooltip = null;
      button.removeAttribute('aria-describedby');
    },
    leave() { if (document.activeElement !== button) handlers.close(); },
    key(event: KeyboardEvent) {
      if (tooltip && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        handlers.close();
      }
    },
    outside(event: PointerEvent) {
      if (!button.contains(event.target as Node)) handlers.close();
    },
  };
  button.addEventListener('mouseenter', handlers.open);
  button.addEventListener('mouseleave', handlers.leave);
  button.addEventListener('focus', handlers.open);
  button.addEventListener('blur', handlers.close);
  button.addEventListener('click', handlers.open);
  button.addEventListener('keydown', handlers.key);
  window.addEventListener('scroll', handlers.place, true);
  window.addEventListener('resize', handlers.place);
  document.addEventListener('keydown', handlers.key);
  document.addEventListener('pointerdown', handlers.outside);
  return () => {
    handlers.close();
    button.removeEventListener('mouseenter', handlers.open);
    button.removeEventListener('mouseleave', handlers.leave);
    button.removeEventListener('focus', handlers.open);
    button.removeEventListener('blur', handlers.close);
    button.removeEventListener('click', handlers.open);
    button.removeEventListener('keydown', handlers.key);
    window.removeEventListener('scroll', handlers.place, true);
    window.removeEventListener('resize', handlers.place);
    document.removeEventListener('keydown', handlers.key);
    document.removeEventListener('pointerdown', handlers.outside);
  };
}

export const REPORT_TOOLTIP_CSS = `
.report-tooltip__trigger {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  text-transform: none;
  letter-spacing: normal;
  text-decoration: underline dotted var(--fg-faint);
  text-underline-offset: 4px;
  cursor: help;
}

.report-tooltip__trigger:hover {
  background: transparent;
  color: var(--fg);
}

.report-tooltip__help {
  display: inline-flex;
  width: 12px;
  height: 12px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--fg-faint);
  border-radius: 50%;
  font-size: 9px;
  vertical-align: middle;
}

/* Render outside the card so the container and report grid cannot clip it. */
.report-tooltip {
  position: fixed;
  z-index: 2000;
  width: min(330px, calc(100vw - 24px));
  padding: 11px 13px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--fg);
  color: var(--bg);
  font-size: 12px;
  line-height: 1.6;
  font-weight: 400;
  box-shadow: 0 5px 18px #17233125;
  pointer-events: none;
}

`;
