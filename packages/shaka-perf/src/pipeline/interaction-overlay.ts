/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { BrowserContext } from 'playwright-core';

// Injected into the page at document-start. Every click and every keydown
// drops one red dot at the centre of the interacted element AND a large
// red chip in the bottom-right corner, both for exactly 25 ms. Same dot,
// same chip, same timer — clicks and key presses share one
// `flash(target, text)` helper so they're visually identical except for
// the chip's text. Chips are placed at fixed `bottom` slots so new chips
// never shift existing ones — no CLS on the overlay itself. Slots are
// reclaimed when the chip auto-removes. Sizes are expressed in vw, sized
// for a target screencast width of 720 px: a 720 px-wide image gets the
// nominal pixel dimensions, regardless of source viewport. On a 375 px
// mobile viewport the chip is small in viewport pixels (e.g. 41 px) but
// scales up to the same 80 px in the stretched-to-720 screenshot — so
// labels look identical between mobile and desktop captures. No
// animations and no persistent state. All styles set via element.style.*
// (no <style> tag, no inline style attr) so the script works on pages
// with strict style-src CSP.
function overlayScript(): void {
  const w = window as unknown as { __shakaperfOverlayInstalled?: boolean };
  if (w.__shakaperfOverlayInstalled) return;
  w.__shakaperfOverlayInstalled = true;

  const HIDE_MS = 25;
  const TARGET_W = 720;
  // Chip + font sizes are deliberately large so tesseract.js OCR (used by
  // the verify-click-coincidence validator) reliably reads the "Click" /
  // key-name glyphs off the screencast crops with the bundled
  // `eng.traineddata` — smaller fonts left the glyphs near the edge of
  // what OCR could resolve in the final frame. CHIP/PAD/GAP scale with the
  // font so the chip still fits the text and stacked slots don't overlap.
  const CHIP_PX = 45;
  const CHIP_PAD_Y = 9;
  const CHIP_PAD_X = 13.5;
  const FONT_PX = 31.5;
  const GAP_PX = 4.5;
  const EDGE_PX = 24;
  const DOT_PX = 16;
  const SLOT_PX = CHIP_PX + GAP_PX;
  const RED = 'rgba(255,40,40,0.95)';

  // Convert a nominal pixel size at the 720 px target width into vw, so
  // the rendered element occupies that nominal width in the final
  // normalised screenshot regardless of source viewport.
  const vw = (px: number): string => (px / TARGET_W * 100) + 'vw';

  const slots: boolean[] = [];
  const takeSlot = (): number => {
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i]) {
        slots[i] = true;
        return i;
      }
    }
    slots.push(true);
    return slots.length - 1;
  };

  const flash = (target: Element | null, text: string): void => {
    const root = document.documentElement;
    if (!root) return;

    if (target) {
      const rect = target.getBoundingClientRect();
      const dot = document.createElement('div');
      dot.style.position = 'fixed';
      dot.style.left = (rect.left + rect.width / 2) + 'px';
      dot.style.top = (rect.top + rect.height / 2) + 'px';
      dot.style.width = vw(DOT_PX);
      dot.style.height = vw(DOT_PX);
      dot.style.transform = 'translate(-50%, -50%)';
      dot.style.borderRadius = '50%';
      dot.style.background = RED;
      dot.style.outline = vw(2) + ' solid white';
      dot.style.pointerEvents = 'none';
      dot.style.zIndex = '2147483647';
      root.appendChild(dot);
      setTimeout(() => { dot.remove(); }, HIDE_MS);
    }

    const slot = takeSlot();
    const chip = document.createElement('div');
    chip.textContent = text;
    chip.style.position = 'fixed';
    chip.style.right = vw(EDGE_PX);
    chip.style.bottom = vw(EDGE_PX + slot * SLOT_PX);
    chip.style.minWidth = vw(CHIP_PX);
    chip.style.minHeight = vw(CHIP_PX);
    chip.style.padding = vw(CHIP_PAD_Y) + ' ' + vw(CHIP_PAD_X);
    chip.style.boxSizing = 'border-box';
    chip.style.display = 'flex';
    chip.style.alignItems = 'center';
    chip.style.justifyContent = 'center';
    chip.style.background = RED;
    chip.style.color = 'white';
    chip.style.font = '700 ' + vw(FONT_PX) + '/1 -apple-system, system-ui, sans-serif';
    chip.style.borderRadius = vw(3);
    chip.style.outline = vw(0.75) + ' solid white';
    chip.style.pointerEvents = 'none';
    chip.style.zIndex = '2147483647';
    chip.style.textAlign = 'center';
    chip.style.whiteSpace = 'nowrap';
    root.appendChild(chip);
    setTimeout(() => { chip.remove(); slots[slot] = false; }, HIDE_MS);
  };

  window.addEventListener('pointerdown', (e: PointerEvent) => {
    flash(e.target as Element | null, 'Click');
  }, { capture: true, passive: true });

  const formatKey = (e: KeyboardEvent): string => {
    let name = e.key;
    if (name === ' ') name = 'Space';
    const prefix: string[] = [];
    if (e.metaKey) prefix.push('Meta');
    if (e.ctrlKey) prefix.push('Ctrl');
    if (e.altKey) prefix.push('Alt');
    if (e.shiftKey && name.length !== 1) prefix.push('Shift');
    return prefix.length ? prefix.join('+') + '+' + name : name;
  };

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return;
    flash((e.target as Element | null) ?? document.activeElement, formatKey(e));
  }, { capture: true, passive: true });
}

// Same reuse hazard as the `__name` shim: the perf worker calls this once per
// sample on a context it never recreates, and `addInitScript` neither dedupes
// nor removes. Without the guard, sample N stacks N overlays on one page.
const overlaidContexts = new WeakSet<BrowserContext>();

export async function attachInteractionOverlay(context: BrowserContext): Promise<void> {
  if (overlaidContexts.has(context)) return;
  overlaidContexts.add(context);
  await context.addInitScript(overlayScript);
}
