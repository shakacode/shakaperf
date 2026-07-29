/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Locator, Page } from 'playwright-core';

export interface RecordedInteractionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordedInteraction {
  /** Milliseconds since `performance.timeOrigin` of the page (≈ navigationStart). */
  timeMs: number;
  kind: 'click' | 'dblclick' | 'tap' | 'fill' | 'type' | 'press';
  selector?: string;
  text?: string;
  key?: string;
  rect?: RecordedInteractionRect;
}

interface RecorderState {
  interactions: RecordedInteraction[];
  pageTimeOriginMs: number;
}

interface LocatorWithRecorder extends Locator {
  __shakaperfRecorder?: RecorderState;
}

interface PageWithRecorder extends Page {
  __shakaperfRecorder?: RecorderState;
}

// 100ms between keystrokes mimics a slow but deliberate typist and gives
// the renderer enough room to settle between keys so each keypress lands
// as its own EventTiming interaction in the trace — and so the per-key
// INP shows up legibly in the timeline strip.
const TYPE_DELAY_MS = 100;

async function safeBoundingBox(locator: Locator): Promise<RecordedInteractionRect | undefined> {
  try {
    const box = await locator.boundingBox({ timeout: 1500 });
    if (!box) return undefined;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  } catch {
    return undefined;
  }
}

async function typeIntoLocator(
  locator: Locator,
  value: string,
  state: RecorderState,
  timeout?: number,
): Promise<void> {
  // Click instead of `.focus()` so the field receives the real
  // pointerdown/up + focus sequence a user would emit — some inputs
  // (combobox shells, contenteditable wrappers) only mount their keystroke
  // handlers after a click, and INP attribution on the focus interaction
  // also depends on the pointer events firing.
  await locator.click({ timeout });
  const owningPage = locator.page();
  // Honour Playwright's `fill` contract: clear the input before typing.
  // Done at the DOM level (rather than via Ctrl/Cmd+A + Delete keystrokes)
  // so the clear doesn't dispatch a key event that the INP attribution
  // pass would pick up and charge against the first character's timing.
  // Guarded by a value-read so we skip the round-trip for already-empty
  // fields (the common case).
  await locator.evaluate((el) => {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    if ('value' in input && input.value !== '') {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  if (!value) return;
  // Capture the input's bounding box once; every keystroke shares the same
  // target so highlighting per-char would draw the same blue rect anyway.
  const rect = await safeBoundingBox(locator);
  // Record one press per character up front. `pressSequentially` dispatches
  // the keystrokes at `delay` intervals, so stamping the records at the
  // same cadence approximates the actual press times well enough for the
  // per-key INP correlation downstream (matched by nearest EventTiming
  // within ±250ms).
  const startTs = Date.now() - state.pageTimeOriginMs;
  for (let i = 0; i < value.length; i++) {
    state.interactions.push({
      timeMs: startTs + i * TYPE_DELAY_MS,
      kind: 'press',
      key: value[i],
      rect,
    });
  }
  // Single awaited call. Playwright's `pressSequentially` awaits each
  // keystroke's CDP acknowledgment internally, so when this resolves all
  // keystrokes have actually been processed by Chrome — the previous
  // hand-rolled loop using `keyboard.type(ch)` in a JS for-loop wasn't
  // fully synchronizing on the final keystroke, so the next playwright
  // statement could race ahead of the last char.
  await locator.pressSequentially(value, { delay: TYPE_DELAY_MS });
  // Post-type pause so a subsequent click/press isn't fired in the same
  // tick as the final keystroke — keeps the EventTiming for the last
  // character separable from whatever the test does next.
  await owningPage.waitForTimeout(TYPE_DELAY_MS);
}

function attachStateToLocator(locator: Locator, state: RecorderState): void {
  (locator as LocatorWithRecorder).__shakaperfRecorder = state;
}

function getStateFromLocator(locator: Locator): RecorderState | undefined {
  return (locator as LocatorWithRecorder).__shakaperfRecorder
    ?? (locator.page() as PageWithRecorder).__shakaperfRecorder;
}

function nowSince(state: RecorderState): number {
  return Date.now() - state.pageTimeOriginMs;
}

export interface InteractionRecorder {
  readonly interactions: RecordedInteraction[];
  attach(page: Page): Promise<void>;
}

export function createInteractionRecorder(): InteractionRecorder {
  const state: RecorderState = { interactions: [], pageTimeOriginMs: 0 };

  return {
    get interactions() {
      return state.interactions;
    },
    async attach(page: Page) {
      state.pageTimeOriginMs = await page.evaluate(() => performance.timeOrigin);
      (page as PageWithRecorder).__shakaperfRecorder = state;

      const pushRecord = async (
        locator: Locator,
        kind: RecordedInteraction['kind'],
        extras: Partial<RecordedInteraction> = {},
      ) => {
        const rect = await safeBoundingBox(locator);
        state.interactions.push({
          timeMs: nowSince(state),
          kind,
          rect,
          ...extras,
        });
      };

      const origPageClick = page.click.bind(page);
      page.click = (async (selector: string, options?: Parameters<Page['click']>[1]) => {
        await pushRecord(page.locator(selector), 'click', { selector });
        return origPageClick(selector, options);
      }) as Page['click'];

      const origPageDblclick = page.dblclick.bind(page);
      page.dblclick = (async (selector: string, options?: Parameters<Page['dblclick']>[1]) => {
        await pushRecord(page.locator(selector), 'dblclick', { selector });
        return origPageDblclick(selector, options);
      }) as Page['dblclick'];

      const origPageTap = page.tap.bind(page);
      page.tap = (async (selector: string, options?: Parameters<Page['tap']>[1]) => {
        await pushRecord(page.locator(selector), 'tap', { selector });
        return origPageTap(selector, options);
      }) as Page['tap'];

      const origPagePress = page.press.bind(page);
      page.press = (async (selector: string, key: string, options?: Parameters<Page['press']>[2]) => {
        await pushRecord(page.locator(selector), 'press', { selector, key });
        return origPagePress(selector, key, options);
      }) as Page['press'];

      page.fill = (async (
        selector: string,
        value: string,
        options?: { timeout?: number },
      ) => {
        // typeIntoLocator records one 'press' per char so each keystroke gets
        // its own pill + INP from the matching EventTiming.
        await typeIntoLocator(page.locator(selector), value, state, options?.timeout);
      }) as Page['fill'];

      // Locator-level patching (idempotent across the process).
      const sampleLocator = page.locator('html') as LocatorWithRecorder;
      attachStateToLocator(sampleLocator, state);
      const locProto = Object.getPrototypeOf(sampleLocator) as Record<string, unknown>;
      if (!locProto.__shakaperfRecorderPatched) {
        const origLocClick = locProto.click as Locator['click'];
        const origLocDblclick = locProto.dblclick as Locator['dblclick'];
        const origLocTap = locProto.tap as Locator['tap'];
        const origLocPress = locProto.press as Locator['press'];
        const origLocFill = locProto.fill as Locator['fill'];

        const recordOnLocator = async (
          self: Locator,
          kind: RecordedInteraction['kind'],
          extras: Partial<RecordedInteraction> = {},
        ) => {
          const s = getStateFromLocator(self);
          if (!s) return;
          const rect = await safeBoundingBox(self);
          s.interactions.push({
            timeMs: Date.now() - s.pageTimeOriginMs,
            kind,
            rect,
            ...extras,
          });
        };

        locProto.click = async function patchedLocatorClick(
          this: Locator,
          options?: Parameters<Locator['click']>[0],
        ) {
          await recordOnLocator(this, 'click');
          return origLocClick.call(this, options);
        } as Locator['click'];

        locProto.dblclick = async function patchedLocatorDblclick(
          this: Locator,
          options?: Parameters<Locator['dblclick']>[0],
        ) {
          await recordOnLocator(this, 'dblclick');
          return origLocDblclick.call(this, options);
        } as Locator['dblclick'];

        locProto.tap = async function patchedLocatorTap(
          this: Locator,
          options?: Parameters<Locator['tap']>[0],
        ) {
          await recordOnLocator(this, 'tap');
          return origLocTap.call(this, options);
        } as Locator['tap'];

        locProto.press = async function patchedLocatorPress(
          this: Locator,
          key: string,
          options?: Parameters<Locator['press']>[1],
        ) {
          await recordOnLocator(this, 'press', { key });
          return origLocPress.call(this, key, options);
        } as Locator['press'];

        locProto.fill = async function patchedLocatorFill(
          this: Locator,
          value: string,
          options?: { timeout?: number },
        ) {
          const s = getStateFromLocator(this);
          if (!s) {
            // No recorder attached — fall back to Playwright's original
            // fill so the call still actually sets the value (and the
            // promise resolves after the real fill completes).
            return origLocFill.call(this, value, options);
          }
          await typeIntoLocator(this, value, s, options?.timeout);
        } as Locator['fill'];

        locProto.__shakaperfRecorderPatched = true;
      }
    },
  };
}
